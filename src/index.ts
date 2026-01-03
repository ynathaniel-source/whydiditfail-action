import * as core from "@actions/core";
import { context } from "@actions/github";
import { fetchJobLogsBestEffort } from "./logs.js";
import { postSummary } from "./summary.js";
import { explainFailure } from "./client.js";

async function run() {
  try {
    const serviceUrl = core.getInput("service_url", { required: true });
    const maxLogKb = Number(core.getInput("max_log_kb") || "400");
    const mode = core.getInput("mode") || "summary";

    // Best-effort logs fetch. For the scaffold, we keep this simple:
    const logs = await fetchJobLogsBestEffort(maxLogKb);

    const payload = {
      runner_os: process.env.RUNNER_OS ?? "unknown",
      job_name: process.env.GITHUB_JOB ?? "unknown",
      failed_step: "unknown",
      log_excerpt: logs
    };

    const result = await explainFailure(serviceUrl, payload);

    if (mode !== "summary") {
      core.warning(`mode=${mode} not implemented in scaffold; using summary`);
    }

    await postSummary(result?.explanation ?? null);
  } catch (err: any) {
    core.setFailed(err?.message ?? String(err));
  }
}

run();
