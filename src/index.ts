import * as core from "@actions/core";
import { context } from "@actions/github";
import { fetchJobLogsBestEffort } from "./logs.js";
import { fetchMultipleFailedJobs } from "./multi-job-logs.js";
import { postSummary } from "./summary.js";
import { explainFailure } from "./client.js";
import { validatePayloadSize } from "./logLimits.js";
import { postFixSuggestions } from "./review-comments.js";
import { getGitContext } from "./git-context.js";

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

    let payload: any = {
      repo: context.payload.repository?.full_name ?? context.repo.owner + "/" + context.repo.repo,
      run_id: context.runId,
      run_number: context.runNumber,
      job: context.job,
      workflow: context.workflow,
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
    } else {
      core.info("Using single-job (legacy) analysis mode");
      const logs = await fetchJobLogsBestEffort(maxLogKb, githubToken);
      payload.log_excerpt = logs;
    }

    validatePayloadSize(payload);

    const result = await explainFailure(serviceUrl, payload, githubToken);

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

    await postSummary(result);

    if (result.skipped) {
      core.info(`⏭️ Analysis skipped: ${result.reason || 'Low confidence'}`);
      return;
    }

    if (suggestFixes && result.fix_suggestions && result.fix_suggestions.length > 0 && githubToken) {
      const { posted, skipped } = await postFixSuggestions(githubToken, result.fix_suggestions, result, cleanupOldComments);
      if (posted > 0) {
        core.info(`✅ Posted ${posted} fix suggestion(s)`);
      }
      if (skipped > 0) {
        core.info(`⏭️  Skipped ${skipped} fix suggestion(s)`);
      }
    }
  } catch (err: any) {
    core.setFailed(err?.message ?? String(err));
  }
}

run();
