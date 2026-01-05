import * as core from "@actions/core";
import { context } from "@actions/github";
import { fetchJobLogsBestEffort } from "./logs.js";
import { postSummary } from "./summary.js";
import { explainFailure } from "./client.js";
import { validatePayloadSize } from "./logLimits.js";
import { postFixSuggestions } from "./review-comments.js";

function parseMaxLogKb(input: string | undefined, defaultValue: number = 400): number {
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
    const serviceUrl = core.getInput("service_url") || "https://wlsuvpvhv2.execute-api.us-east-1.amazonaws.com";
    const githubToken = core.getInput("github_token") || process.env.GITHUB_TOKEN;
    const maxLogKb = parseMaxLogKb(core.getInput("max_log_kb"));
    const mode = core.getInput("mode") || "summary";
    const suggestFixes = core.getInput("suggest_fixes") !== "false";
    const cleanupOldComments = core.getInput("cleanup_old_comments") !== "false";

    const logs = await fetchJobLogsBestEffort(maxLogKb, githubToken);

    const payload = {
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
      log_excerpt: logs
    };

    validatePayloadSize(payload);

    const result = await explainFailure(serviceUrl, payload, githubToken);

    if (mode !== "summary") {
      core.warning(`mode=${mode} not implemented in scaffold; using summary`);
    }

    await postSummary(result);

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
