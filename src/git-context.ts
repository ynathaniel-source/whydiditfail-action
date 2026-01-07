import * as core from "@actions/core";
import { context } from "@actions/github";
import { Octokit } from "@octokit/rest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_DIFF_CHARS = 20000;
const MAX_COMMIT_MSG_CHARS = 5000;

interface GitContext {
  base_sha?: string;
  head_sha: string;
  modified_files: string[];
  diff: string;
  commit_messages: string;
  only_tests_changed: boolean;
  dependencies_changed: boolean;
  ci_config_changed: boolean;
}

function truncate(s: string, maxChars: number): string {
  if (!s) return s;
  return s.length > maxChars ? s.slice(0, maxChars) + "\n...TRUNCATED...\n" : s;
}

async function git(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { 
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5000
    });
    return stdout.toString().trim();
  } catch (error) {
    throw error;
  }
}

function getBaseShaFromEvent(): string | undefined {
  if (context.eventName === "pull_request") {
    return context.payload.pull_request?.base?.sha;
  }
  if (context.eventName === "push") {
    return context.payload.before;
  }
  return undefined;
}

function computeHeuristics(modifiedFiles: string[]): {
  only_tests_changed: boolean;
  dependencies_changed: boolean;
  ci_config_changed: boolean;
} {
  if (modifiedFiles.length === 0) {
    return {
      only_tests_changed: false,
      dependencies_changed: false,
      ci_config_changed: false
    };
  }

  const testPatterns = [
    /test/i,
    /__tests__/,
    /\.test\./,
    /\.spec\./,
    /_test\./,
    /^tests?\//
  ];

  const dependencyFiles = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "requirements.txt",
    "Pipfile.lock",
    "Gemfile.lock",
    "go.sum",
    "Cargo.lock",
    "composer.lock"
  ];

  const ciPatterns = [
    /^\.github\/workflows\//,
    /^\.circleci\//,
    /^\.gitlab-ci/,
    /^\.travis\.yml$/,
    /^azure-pipelines/,
    /^Jenkinsfile$/
  ];

  const testFiles = modifiedFiles.filter(f => 
    testPatterns.some(pattern => pattern.test(f))
  );

  const only_tests_changed = testFiles.length > 0 && testFiles.length === modifiedFiles.length;

  const dependencies_changed = modifiedFiles.some(f => 
    dependencyFiles.some(dep => f.endsWith(dep))
  );

  const ci_config_changed = modifiedFiles.some(f =>
    ciPatterns.some(pattern => pattern.test(f))
  );

  return {
    only_tests_changed,
    dependencies_changed,
    ci_config_changed
  };
}

async function getGitContextLocal(headSha: string, baseSha?: string): Promise<GitContext | null> {
  try {
    let modifiedFiles: string[] = [];
    let diff = "";
    let commitMessages = "";

    if (baseSha) {
      const filesOutput = await git(["diff", "--name-only", `${baseSha}...${headSha}`]);
      modifiedFiles = filesOutput.split("\n").filter(Boolean);

      diff = await git(["diff", "--unified=3", `${baseSha}...${headSha}`]);
      commitMessages = await git(["log", "--format=%s%n%b%n---", `${baseSha}..${headSha}`]);
    } else {
      commitMessages = await git(["log", "--format=%s%n%b", "-n", "1", headSha]);
    }

    const heuristics = computeHeuristics(modifiedFiles);

    return {
      base_sha: baseSha,
      head_sha: headSha,
      modified_files: modifiedFiles,
      diff: truncate(diff, MAX_DIFF_CHARS),
      commit_messages: truncate(commitMessages, MAX_COMMIT_MSG_CHARS),
      ...heuristics
    };
  } catch (error) {
    core.debug(`Local git context failed: ${error}`);
    return null;
  }
}

async function getGitContextViaAPI(
  githubToken: string,
  headSha: string,
  baseSha?: string
): Promise<GitContext | null> {
  try {
    const octokit = new Octokit({ auth: githubToken });
    const { owner, repo } = context.repo;

    let modifiedFiles: string[] = [];
    let diff = "";
    let commitMessages = "";

    if (baseSha) {
      const compareResponse = await octokit.repos.compareCommits({
        owner,
        repo,
        base: baseSha,
        head: headSha
      });

      modifiedFiles = compareResponse.data.files?.map(f => f.filename) || [];
      
      const diffResponse = await octokit.repos.compareCommits({
        owner,
        repo,
        base: baseSha,
        head: headSha,
        mediaType: { format: "diff" }
      });
      diff = String(diffResponse.data);

      const commitsResponse = await octokit.repos.compareCommits({
        owner,
        repo,
        base: baseSha,
        head: headSha
      });
      commitMessages = commitsResponse.data.commits
        .map(c => `${c.commit.message}\n---`)
        .join("\n");
    } else {
      const commitResponse = await octokit.repos.getCommit({
        owner,
        repo,
        ref: headSha
      });
      commitMessages = commitResponse.data.commit.message;
      modifiedFiles = commitResponse.data.files?.map(f => f.filename) || [];
    }

    const heuristics = computeHeuristics(modifiedFiles);

    return {
      base_sha: baseSha,
      head_sha: headSha,
      modified_files: modifiedFiles,
      diff: truncate(diff, MAX_DIFF_CHARS),
      commit_messages: truncate(commitMessages, MAX_COMMIT_MSG_CHARS),
      ...heuristics
    };
  } catch (error) {
    core.warning(`Failed to fetch git context via API: ${error}`);
    return null;
  }
}

export async function getGitContext(githubToken: string): Promise<GitContext> {
  const headSha = context.sha;
  const baseSha = getBaseShaFromEvent();

  core.debug(`Fetching git context: head=${headSha}, base=${baseSha}`);

  let gitContext = await getGitContextLocal(headSha, baseSha);
  
  if (!gitContext) {
    core.info("Local git context unavailable, fetching via GitHub API...");
    gitContext = await getGitContextViaAPI(githubToken, headSha, baseSha);
  }

  if (!gitContext) {
    core.warning("Could not fetch git context, proceeding without it");
    return {
      head_sha: headSha,
      base_sha: baseSha,
      modified_files: [],
      diff: "",
      commit_messages: "",
      only_tests_changed: false,
      dependencies_changed: false,
      ci_config_changed: false
    };
  }

  core.info(`Git context: ${gitContext.modified_files.length} files changed, diff=${gitContext.diff.length} chars`);
  if (gitContext.only_tests_changed) core.info("🧪 Only test files changed");
  if (gitContext.dependencies_changed) core.info("📦 Dependencies changed");
  if (gitContext.ci_config_changed) core.info("⚙️  CI config changed");

  return gitContext;
}
