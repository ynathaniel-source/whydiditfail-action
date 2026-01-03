import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "node:fs";
export async function fetchJobLogsBestEffort(maxLogKb) {
    const path = process.env.WHYDIDITFAIL_LOG_PATH;
    if (path && fs.existsSync(path)) {
        core.info(`Using logs from file: ${path}`);
        const buf = fs.readFileSync(path);
        return truncate(buf.toString("utf8"), maxLogKb * 1024);
    }
    try {
        core.info("Fetching logs from GitHub API");
        const logs = await fetchLogsFromGitHub();
        return truncate(logs, maxLogKb * 1024);
    }
    catch (error) {
        core.warning(`Failed to fetch logs from GitHub API: ${error}`);
        return truncate("Failed to fetch logs. Ensure GITHUB_TOKEN has appropriate permissions.", maxLogKb * 1024);
    }
}
async function fetchLogsFromGitHub() {
    const token = core.getInput("github_token", { required: true });
    if (!token) {
        throw new Error("github_token input is required to fetch logs");
    }
    const context = github.context;
    const octokit = github.getOctokit(token);
    const runId = context.runId;
    const { owner, repo } = context.repo;
    core.info(`Fetching jobs for run ${runId} in ${owner}/${repo}`);
    const { data: jobs } = await octokit.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: runId,
    });
    const failedJobs = jobs.jobs.filter((job) => job.status === "completed" && job.conclusion === "failure");
    if (failedJobs.length === 0) {
        core.warning("No failed jobs found in this workflow run");
        return "No failed jobs found";
    }
    core.info(`Found ${failedJobs.length} failed job(s)`);
    const logPromises = failedJobs.map(async (job) => {
        try {
            core.info(`Downloading logs for job: ${job.name} (${job.id})`);
            const logResponse = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
                owner,
                repo,
                job_id: job.id,
            });
            const logs = typeof logResponse.data === 'string'
                ? logResponse.data
                : Buffer.from(logResponse.data).toString('utf-8');
            return {
                jobName: job.name,
                jobId: job.id,
                logs: extractRelevantLogs(logs, job.name)
            };
        }
        catch (error) {
            core.warning(`Failed to download logs for job ${job.name}: ${error}`);
            return {
                jobName: job.name,
                jobId: job.id,
                logs: `Failed to download logs: ${error}`
            };
        }
    });
    const jobLogs = await Promise.all(logPromises);
    const combinedLogs = jobLogs
        .map((jl) => `\n=== Job: ${jl.jobName} (ID: ${jl.jobId}) ===\n${jl.logs}`)
        .join("\n\n");
    return combinedLogs;
}
function extractRelevantLogs(fullLogs, jobName) {
    const lines = fullLogs.split("\n");
    const relevantLines = [];
    let inFailedStep = false;
    let errorContext = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isStepBoundary(line)) {
            if (inFailedStep && errorContext > 0) {
                inFailedStep = false;
                errorContext = 0;
            }
            if (containsErrorIndicator(line)) {
                inFailedStep = true;
                relevantLines.push(line);
                for (let j = Math.max(0, i - 5); j < i; j++) {
                    if (!relevantLines.includes(lines[j])) {
                        relevantLines.push(lines[j]);
                    }
                }
                continue;
            }
        }
        if (inFailedStep) {
            relevantLines.push(line);
            if (containsErrorIndicator(line)) {
                errorContext = 20;
            }
        }
        else if (containsErrorIndicator(line)) {
            for (let j = Math.max(0, i - 5); j < Math.min(lines.length, i + 20); j++) {
                if (!relevantLines.includes(lines[j])) {
                    relevantLines.push(lines[j]);
                }
            }
        }
        if (errorContext > 0) {
            errorContext--;
        }
    }
    if (relevantLines.length === 0) {
        const lastLines = lines.slice(-100);
        return lastLines.join("\n");
    }
    return relevantLines.join("\n");
}
function isStepBoundary(line) {
    return /^##\[group\]|^##\[endgroup\]|^Run |^Post |^Set up job|^Complete job/.test(line);
}
function containsErrorIndicator(line) {
    const errorPatterns = [
        /error:/i,
        /failed/i,
        /ERR!/i,
        /\[error\]/i,
        /exception/i,
        /fatal/i,
        /✕/,
        /❌/,
        /exit code [1-9]/i,
        /Process completed with exit code [1-9]/i,
        /ENOENT/,
        /EACCES/,
        /ECONNREFUSED/,
        /npm ERR!/,
        /yarn error/,
        /pip install failed/i,
        /compilation failed/i,
        /test.*failed/i,
        /cannot find/i,
        /undefined/i,
        /null is not/i,
        /permission denied/i,
        /timeout/i,
        /killed/i,
        /SIGTERM/,
        /SIGKILL/,
    ];
    return errorPatterns.some((pattern) => pattern.test(line));
}
function truncate(s, maxBytes) {
    const b = Buffer.from(s, "utf8");
    if (b.length <= maxBytes)
        return s;
    core.warning(`Logs truncated from ${b.length} to ${maxBytes} bytes`);
    return b.subarray(b.length - maxBytes).toString("utf8");
}
