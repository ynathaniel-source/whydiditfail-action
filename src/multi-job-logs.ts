import * as core from "@actions/core";
import * as github from "@actions/github";

export interface FailedJobLogs {
  name: string;
  logs: string;
  conclusion: string;
}

const MAX_JOBS = parseInt(process.env.ACTION_MAX_JOBS || '10', 10);
const MAX_LOG_PER_JOB_KB = parseInt(process.env.ACTION_MAX_LOG_PER_JOB_KB || '64', 10);

export async function fetchMultipleFailedJobs(token?: string): Promise<FailedJobLogs[]> {
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

  const failedJobs = jobs.jobs.filter(
    (job) => 
      job.conclusion === 'failure' && 
      job.name !== currentJobName &&
      job.status === 'completed'
  ).slice(0, MAX_JOBS);

  if (failedJobs.length === 0) {
    core.info('No completed failed jobs found to analyze');
    return [];
  }

  core.info(`Found ${failedJobs.length} failed jobs to analyze`);

  const results: FailedJobLogs[] = [];

  for (const job of failedJobs) {
    core.info(`Downloading logs for failed job: ${job.name} (${job.id})`);
    
    try {
      const logResponse = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: job.id,
      });

      const fullLogs = typeof logResponse.data === 'string' 
        ? logResponse.data 
        : Buffer.from(logResponse.data as ArrayBuffer).toString('utf-8');

      const relevantLogs = extractRelevantLogs(fullLogs, job.name);
      const truncatedLogs = truncateToByteLimit(relevantLogs, MAX_LOG_PER_JOB_KB * 1024);

      results.push({
        name: job.name,
        logs: truncatedLogs,
        conclusion: job.conclusion || 'failure'
      });

      core.info(`Extracted ${truncatedLogs.length} bytes for job ${job.name}`);
    } catch (error) {
      core.warning(`Failed to download logs for job ${job.name}: ${error}`);
    }
  }

  return results;
}

function extractRelevantLogs(fullLogs: string, jobName: string): string {
  const lines = fullLogs.split("\n");
  const relevantLines: string[] = [];
  const seenLines = new Set<string>();
  let inFailedStep = false;
  let errorContext = 0;

  core.info(`Extracting relevant logs from ${lines.length} total lines for job ${jobName}`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isStepBoundary(line)) {
      if (inFailedStep && errorContext > 0) {
        inFailedStep = false;
        errorContext = 0;
      }
      
      if (containsErrorIndicator(line)) {
        inFailedStep = true;
        core.info(`Found failed step at line ${i}: ${line.substring(0, 100)}`);
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

  core.info(`Extracted ${relevantLines.length} relevant lines for job ${jobName}`);

  if (relevantLines.length === 0) {
    core.info("No relevant lines found, returning last 100 lines");
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

function truncateToByteLimit(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) {
    return text;
  }

  core.warning(`Truncating logs from ${buffer.length} to ${maxBytes} bytes`);

  const keepStart = Math.floor(maxBytes * 0.4);
  const keepEnd = Math.floor(maxBytes * 0.4);

  const startBuffer = buffer.subarray(0, keepStart);
  const endBuffer = buffer.subarray(buffer.length - keepEnd);

  const truncationMarker = Buffer.from(`\n\n... [Truncated to fit ${maxBytes} byte limit] ...\n\n`, 'utf8');

  return Buffer.concat([startBuffer, truncationMarker, endBuffer]).toString('utf8');
}
