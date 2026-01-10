import * as core from "@actions/core";
import { context } from "@actions/github";
import { fetchJobLogsBestEffort, extractFailedStepName } from "./logs.js";
import { fetchMultipleFailedJobs } from "./multi-job-logs.js";
import { postSummary } from "./summary.js";
import { explainFailure, analyzeWithPolling } from "./client.js";
import { validatePayloadSize } from "./logLimits.js";
import { postFixSuggestions } from "./review-comments.js";
import { getGitContext } from "./git-context.js";
import { PostingStatus } from "./posting-status.js";
import * as fs from "fs";
import * as path from "path";

function parseMaxLogKb(input: string | undefined, defaultValue: number = 64): number {
  if (!input) return defaultValue;
  
  const parsed = Number(input);
  
  if (isNaN(parsed) || !isFinite(parsed)) {
    throw new Error(`max_log_kb must be a valid number, got: ${input}`);
  }
  
  if (parsed <= 0) {
    throw new Error(`max_log_kb must be positive, got: ${parsed}`);
  }
  
  if (parsed > 10000) {
    core.warning(`max_log_kb=${parsed} is very large, consider reducing it`);
  }
  
  return parsed;
}

function getWorkflowContent(): string | undefined {
  try {
    const workflowPath = process.env.GITHUB_WORKFLOW_REF;
    if (!workflowPath) {
      core.debug("GITHUB_WORKFLOW_REF not available");
      return undefined;
    }
    
    const match = workflowPath.match(/\.github\/workflows\/([^@]+)/);
    if (!match) {
      core.debug(`Could not parse workflow file from: ${workflowPath}`);
      return undefined;
    }
    
    const workflowFile = match[1];
    const workspaceDir = process.env.GITHUB_WORKSPACE || process.cwd();
    const fullPath = path.join(workspaceDir, ".github", "workflows", workflowFile);
    
    if (!fs.existsSync(fullPath)) {
      core.debug(`Workflow file not found: ${fullPath}`);
      return undefined;
    }
    
    const content = fs.readFileSync(fullPath, "utf-8");
    core.info(`Read workflow file: ${workflowFile} (${content.length} bytes)`);
    return content;
  } catch (error) {
    core.debug(`Failed to read workflow file: ${error}`);
    return undefined;
  }
}

async function run() {
  try {
    const serviceUrl = core.getInput("service_url") || "https://4tt0zovbna.execute-api.us-east-1.amazonaws.com";
    const githubToken = core.getInput("github_token") || process.env.GITHUB_TOKEN;
    const maxLogKb = parseMaxLogKb(core.getInput("max_log_kb"));
    const mode = core.getInput("mode") || "summary";
    const suggestFixes = core.getInput("suggest_fixes") !== "false";
    const cleanupOldComments = core.getInput("cleanup_old_comments") !== "false";
    const useMultiJob = core.getInput("multi_job") !== "false";

    const gitContext = await getGitContext(githubToken || "");
    const workflowContent = getWorkflowContent();

    let payload: any = {
      repo: context.payload.repository?.full_name ?? context.repo.owner + "/" + context.repo.repo,
      run_id: context.runId,
      run_number: context.runNumber,
      job: context.job,
      workflow: workflowContent || context.workflow,
      actor: context.actor,
      event_name: context.eventName,
      ref: context.ref,
      sha: context.sha,
      runner_os: process.env.RUNNER_OS ?? "unknown",
      failed_step: "unknown",
      base_sha: gitContext.base_sha,
      modified_files: gitContext.modified_files,
      commit_messages: gitContext.commit_messages,
      diff: gitContext.diff,
      only_tests_changed: gitContext.only_tests_changed,
      dependencies_changed: gitContext.dependencies_changed,
      ci_config_changed: gitContext.ci_config_changed
    };

    if (useMultiJob) {
      core.info("Using multi-job analysis mode");
      const failedJobs = await fetchMultipleFailedJobs(githubToken);
      
      if (failedJobs.length === 0) {
        core.warning("No failed jobs found to analyze");
        return;
      }

      core.info(`Sending ${failedJobs.length} failed jobs for analysis`);
      payload.failed_jobs = failedJobs;
      
      if (failedJobs.length > 0 && failedJobs[0].logs) {
        const detectedStep = extractFailedStepName(failedJobs[0].logs);
        if (detectedStep !== "unknown") {
          payload.failed_step = detectedStep;
        }
      }
    } else {
      core.info("Using single-job (legacy) analysis mode");
      const logs = await fetchJobLogsBestEffort(maxLogKb, githubToken);
      payload.log_excerpt = logs;
      
      const detectedStep = extractFailedStepName(logs);
      if (detectedStep !== "unknown") {
        payload.failed_step = detectedStep;
      }
    }

    validatePayloadSize(payload);

    let result;
    if (useMultiJob) {
      core.info("Using async analysis with polling");
      result = await analyzeWithPolling(serviceUrl, payload, githubToken, 75, 3);
    } else {
      core.info("Using synchronous analysis (legacy mode)");
      result = await explainFailure(serviceUrl, payload, githubToken);
    }

    // Debug: Log the first job's locations to see what paths are being returned
    if (result.jobs && result.jobs.length > 0) {
      for (const job of result.jobs) {
        if (job.locations && job.locations.length > 0) {
          core.info(`DEBUG: Job "${job.jobName}" locations: ${JSON.stringify(job.locations)}`);
        }
      }
    }

    if (mode !== "summary") {
      core.warning(`mode=${mode} not implemented in scaffold; using summary`);
    }

    const postingStatus: PostingStatus = {
      analysisCompleted: true
    };

    if (result.skipped) {
      core.info(`⏭️ Analysis skipped: ${result.reason || 'Low confidence'}`);
      await postSummary(result, postingStatus);
      return;
    }

    if (suggestFixes && result.fix_suggestions && result.fix_suggestions.length > 0 && githubToken) {
      postingStatus.suggestions = {
        attempted: true,
        total: result.fix_suggestions.length,
        posted: 0,
        skipped: 0,
        status: { ok: true }
      };

      try {
        const { posted, skipped, errors } = await postFixSuggestions(githubToken, result.fix_suggestions, result, cleanupOldComments);
        
        postingStatus.suggestions.posted = posted;
        postingStatus.suggestions.skipped = skipped;

        if (errors.length > 0) {
          postingStatus.suggestions.status = { ok: false, reason: errors[0] };
        }

        if (posted > 0) {
          core.info(`✅ Posted ${posted} fix suggestion(s)`);
        }
        if (skipped > 0) {
          core.info(`⏭️  Skipped ${skipped} fix suggestion(s)`);
        }
      } catch (error: any) {
        const errorMsg = error?.message ?? String(error);
        postingStatus.suggestions.status = { ok: false, reason: errorMsg };
        core.warning(`Failed to post fix suggestions: ${errorMsg}`);
      }
    } else if (suggestFixes && !githubToken) {
      postingStatus.suggestions = {
        attempted: false,
        total: result.fix_suggestions?.length || 0,
        posted: 0,
        skipped: 0,
        status: { ok: false, reason: 'No GitHub token provided' }
      };
    } else if (suggestFixes && (!result.fix_suggestions || result.fix_suggestions.length === 0)) {
      postingStatus.suggestions = {
        attempted: false,
        total: 0,
        posted: 0,
        skipped: 0,
        status: { ok: false, reason: 'No fix suggestions available' }
      };
    } else if (!suggestFixes) {
      postingStatus.suggestions = {
        attempted: false,
        total: result.fix_suggestions?.length || 0,
        posted: 0,
        skipped: 0,
        status: { ok: false, reason: 'Feature disabled (suggest_fixes=false)' }
      };
    }

    await postSummary(result, postingStatus);
  } catch (err: any) {
    core.setFailed(err?.message ?? String(err));
  }
}

run();
