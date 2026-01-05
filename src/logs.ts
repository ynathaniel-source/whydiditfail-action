import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "node:fs";

export async function fetchJobLogsBestEffort(maxLogKb: number, token?: string): Promise<string> {
  const path = process.env.WHYDIDITFAIL_LOG_PATH;
  if (path && fs.existsSync(path)) {
    core.info(`Using logs from file: ${path}`);
    const buf = fs.readFileSync(path);
    return truncate(buf.toString("utf8"), maxLogKb * 1024);
  }

  try {
    core.info("Fetching logs from GitHub API");
    const logs = await fetchLogsFromGitHub(token);
    return truncate(logs, maxLogKb * 1024);
  } catch (error) {
    core.warning(`Failed to fetch logs from GitHub API: ${error}`);
    return truncate(
      "Failed to fetch logs. Ensure GITHUB_TOKEN has appropriate permissions.",
      maxLogKb * 1024
    );
  }
}

async function fetchLogsFromGitHub(token?: string): Promise<string> {
  const githubToken = token || process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is required to fetch logs");
  }

  const context = github.context;
  const octokit = github.getOctokit(githubToken);

  const runId = context.runId;
  const { owner, repo } = context.repo;
  const currentJobName = context.job;

  core.info(`Fetching jobs for run ${runId} in ${owner}/${repo}`);

  const { data: jobs } = await octokit.rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });

  const currentJob = jobs.jobs.find((job) => job.name === currentJobName);

  if (!currentJob) {
    core.warning(`Could not find current job: ${currentJobName}`);
    return `Could not find logs for job: ${currentJobName}`;
  }

  core.info(`Downloading logs for current job: ${currentJob.name} (${currentJob.id})`);

  try {
    const logResponse = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: currentJob.id,
    });

    const logs = typeof logResponse.data === 'string' 
      ? logResponse.data 
      : Buffer.from(logResponse.data as ArrayBuffer).toString('utf-8');

    return extractRelevantLogs(logs, currentJob.name);
  } catch (error) {
    core.warning(`Failed to download logs for job ${currentJob.name}: ${error}`);
    return `Failed to download logs: ${error}`;
  }
}

function extractRelevantLogs(fullLogs: string, jobName: string): string {
  const lines = fullLogs.split("\n");
  const relevantLines: string[] = [];
  const seenLines = new Set<string>();
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
        if (!seenLines.has(line)) {
          seenLines.add(line);
          relevantLines.push(line);
        }
        
        for (let j = Math.max(0, i - 10); j < i; j++) {
          if (!seenLines.has(lines[j])) {
            seenLines.add(lines[j]);
            relevantLines.push(lines[j]);
          }
        }
        continue;
      }
    }

    if (inFailedStep) {
      if (!seenLines.has(line)) {
        seenLines.add(line);
        relevantLines.push(line);
      }
      if (containsErrorIndicator(line)) {
        errorContext = 30;
      }
    } else if (containsErrorIndicator(line)) {
      for (let j = Math.max(0, i - 10); j < Math.min(lines.length, i + 30); j++) {
        if (!seenLines.has(lines[j])) {
          seenLines.add(lines[j]);
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

function isStepBoundary(line: string): boolean {
  return /^##\[group\]|^##\[endgroup\]|^Run |^Post |^Set up job|^Complete job/.test(line);
}

function containsErrorIndicator(line: string): boolean {
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

function truncate(s: string, maxBytes: number): string {
  const b = Buffer.from(s, "utf8");
  if (b.length <= maxBytes) return s;
  
  core.warning(`Logs truncated from ${b.length} to ${maxBytes} bytes`);
  
  let start = b.length - maxBytes;
  
  while (start < b.length && (b[start] & 0b1100_0000) === 0b1000_0000) {
    start++;
  }
  
  return b.subarray(start).toString("utf8");
}
