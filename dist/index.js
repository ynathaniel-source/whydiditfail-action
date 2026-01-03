import * as core from "@actions/core";
import { context } from "@actions/github";
import { fetchJobLogsBestEffort } from "./logs.js";
import { postSummary } from "./summary.js";
import { explainFailure } from "./client.js";
import { validatePayloadSize } from "./logLimits.js";
async function run() {
    try {
        const serviceUrl = core.getInput("service_url") || "https://api.whydiditfail.com";
        const githubToken = core.getInput("github_token");
        const maxLogKb = Number(core.getInput("max_log_kb") || "400");
        const mode = core.getInput("mode") || "summary";
        const logs = await fetchJobLogsBestEffort(maxLogKb);
        const payload = {
            repo: context.repo.owner + "/" + context.repo.repo,
            run_id: context.runId,
            run_number: context.runNumber,
            job: process.env.GITHUB_JOB ?? "unknown",
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
        await postSummary(result?.explanation ?? null);
    }
    catch (err) {
        core.setFailed(err?.message ?? String(err));
    }
}
run();
