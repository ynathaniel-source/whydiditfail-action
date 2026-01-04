import * as core from '@actions/core';
import * as github from '@actions/github';

export interface FixSuggestion {
  path: string;
  line_start: number;
  line_end: number;
  replacement: string;
  title?: string;
  rationale?: string;
  confidence: number;
}

export async function postFixSuggestions(
  token: string,
  fixSuggestions: FixSuggestion[]
): Promise<{ posted: number; skipped: number }> {
  if (!fixSuggestions || fixSuggestions.length === 0) {
    return { posted: 0, skipped: 0 };
  }

  const context = github.context;
  const octokit = github.getOctokit(token);

  const isPR = context.payload.pull_request !== undefined;
  const commitSha = context.sha;

  let posted = 0;
  let skipped = 0;

  if (isPR) {
    posted = await postPRReviewComments(octokit, context, fixSuggestions, commitSha);
  } else {
    posted = await postCommitComments(octokit, context, fixSuggestions, commitSha);
  }

  return { posted, skipped: fixSuggestions.length - posted };
}

async function postPRReviewComments(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  fixSuggestions: FixSuggestion[],
  commitSha: string
): Promise<number> {
  const { owner, repo } = context.repo;
  const pullNumber = context.payload.pull_request!.number;

  const comments = fixSuggestions.map(fix => {
    const body = buildSuggestionBody(fix, true);
    
    const comment: any = {
      path: fix.path,
      body,
      line: fix.line_end
    };

    if (fix.line_start !== fix.line_end) {
      comment.start_line = fix.line_start;
    }

    return comment;
  });

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: commitSha,
      event: 'COMMENT',
      comments
    });

    core.info(`Posted ${comments.length} inline fix suggestions to PR #${pullNumber}`);
    return comments.length;
  } catch (error) {
    core.warning(`Failed to post PR review comments: ${error}`);
    return 0;
  }
}

async function postCommitComments(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  fixSuggestions: FixSuggestion[],
  commitSha: string
): Promise<number> {
  const { owner, repo } = context.repo;

  let posted = 0;

  for (const fix of fixSuggestions) {
    try {
      const body = buildSuggestionBody(fix, false);

      await octokit.rest.repos.createCommitComment({
        owner,
        repo,
        commit_sha: commitSha,
        path: fix.path,
        line: fix.line_end,
        body
      });

      posted++;
    } catch (error) {
      core.warning(`Failed to post commit comment for ${fix.path}: ${error}`);
    }
  }

  if (posted > 0) {
    core.info(`Posted ${posted} fix suggestions as commit comments`);
  }

  return posted;
}

function buildSuggestionBody(fix: FixSuggestion, useSuggestionSyntax: boolean): string {
  const title = fix.title || 'Suggested fix';
  const rationale = fix.rationale || 'This change should resolve the error.';
  const confidencePercent = Math.round(fix.confidence * 100);

  let body = `## 🔧 ${title}\n\n`;
  body += `**Confidence:** ${confidencePercent}%\n\n`;
  body += `${rationale}\n\n`;

  if (useSuggestionSyntax) {
    body += '```suggestion\n';
    body += fix.replacement;
    body += '\n```\n';
  } else {
    body += '**Suggested code:**\n\n';
    body += '```\n';
    body += fix.replacement;
    body += '\n```\n';
  }

  body += '\n---\n';
  body += '<sub>💡 Review this suggestion carefully before applying</sub>';

  return body;
}
