import * as core from '@actions/core';
import * as github from '@actions/github';

const WDF_MARKER = '<!-- whydiditfail -->';

function getPullNumber(context: typeof github.context): number {
  const pullNumber = context.payload.pull_request?.number ?? context.issue?.number;
  if (!pullNumber) {
    throw new Error('Could not determine pull request number from context');
  }
  return pullNumber;
}

export interface FixSuggestion {
  path: string;
  line_start: number;
  line_end: number;
  replacement: string;
  title?: string;
  rationale?: string;
  confidence: number;
  error_code?: string;
  evidence?: string;
  tip?: string;
  jobName?: string;
}

export interface PostFixSuggestionsResult {
  posted: number;
  skipped: number;
  errors: string[];
}

export async function postFixSuggestions(
  token: string,
  fixSuggestions: FixSuggestion[],
  apiResponse?: any,
  cleanupOldComments: boolean = false
): Promise<PostFixSuggestionsResult> {
  const context = github.context;
  const octokit = github.getOctokit(token);
  const isPR = context.payload.pull_request !== undefined;
  const commitSha = context.sha;
  const errors: string[] = [];

  if (!fixSuggestions || fixSuggestions.length === 0) {
    if (isPR && apiResponse?.root_cause) {
      const pullNumber = getPullNumber(context);
      try {
        await postNoSuggestionComment(octokit, context, pullNumber, apiResponse, cleanupOldComments);
        return { posted: 1, skipped: 0, errors: [] };
      } catch (error) {
        const errorMsg = toErrorMessage(error);
        errors.push(errorMsg);
        return { posted: 0, skipped: 0, errors };
      }
    }
    return { posted: 0, skipped: 0, errors: [] };
  }

  let posted = 0;
  let skipped = 0;

  if (isPR) {
    const result = await postPRReviewComments(octokit, context, fixSuggestions, commitSha, apiResponse, cleanupOldComments);
    posted = result.posted;
    if (result.error) {
      errors.push(result.error);
    }
  } else {
    const result = await postCommitComments(octokit, context, fixSuggestions, commitSha);
    posted = result.posted;
    if (result.error) {
      errors.push(result.error);
    }
  }

  return { posted, skipped: fixSuggestions.length - posted, errors };
}

async function postNoSuggestionComment(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  pullNumber: number,
  apiResponse: any,
  cleanupOldComments: boolean = false
): Promise<void> {
  const { owner, repo } = context.repo;
  const runId = context.runId;
  const jobName = context.job;

  if (cleanupOldComments) {
    await cleanupOldPRComments(octokit, owner, repo, pullNumber, runId);
    await cleanupOldReviewComments(octokit, owner, repo, pullNumber, runId);
  }

  const rootCause = apiResponse.root_cause || 'Test failed';
  const category = apiResponse.category || 'unknown';
  
  let body = `## 🤖 WhyDidItFail\n\n`;
  body += `### 🔧 Analysis Complete\n\n`;
  body += `> No immediate code fix suggestions available for this failure.\n\n`;
  
  if (apiResponse) {
    const remaining = apiResponse.remaining ?? 0;
    const limit = apiResponse.limit ?? 35;
    
    let usageText = `📊 **Usage:** ${remaining} / ${limit} remaining`;
    
    if (apiResponse.reset_at) {
      const resetDate = new Date(apiResponse.reset_at);
      usageText += ` · 🔁 resets ${resetDate.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric'
      })}`;
    }
    
    body += `${usageText}\n\n`;
  }
  
  body += `---\n\n`;
  body += `**Issue:** ${rootCause}\n\n`;
  body += `**Category:** \`${category}\`\n\n`;
  
  if (apiResponse.fixes && Array.isArray(apiResponse.fixes) && apiResponse.fixes.length > 0) {
    body += `**Recommended Actions:**\n\n`;
    apiResponse.fixes.forEach((fix: any, i: number) => {
      const fixText = typeof fix === 'string' ? fix : fix.description || fix;
      body += `${i + 1}. ${fixText}\n`;
    });
    body += '\n';
  }
  
  body += `---\n\n`;
  body += `<sub>Job: ${jobName} · Run #${runId} · Powered by [WhyDidItFail](https://github.com/marketplace/actions/whydiditfail)</sub>\n\n`;
  body += WDF_MARKER;

  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body
    });

    core.info(`Posted analysis comment (no fix suggestions) to PR #${pullNumber}`);
  } catch (error) {
    core.warning(`Failed to post no-suggestion comment: ${error}`);
  }
}

interface PostingResult {
  posted: number;
  error?: string;
}

async function postPRReviewComments(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  fixSuggestions: FixSuggestion[],
  commitSha: string,
  apiResponse?: any,
  cleanupOldComments: boolean = false
): Promise<PostingResult> {
  const { owner, repo } = context.repo;
  const pullNumber = getPullNumber(context);
  const runId = context.runId;
  const jobName = context.job;

  if (cleanupOldComments) {
    await cleanupOldPRComments(octokit, owner, repo, pullNumber, runId);
    await cleanupOldReviewComments(octokit, owner, repo, pullNumber, runId);
  }

  const groupedFixes = groupFixesByFile(fixSuggestions);
  const comments: any[] = [];

  for (const [filePath, fixes] of Object.entries(groupedFixes)) {
    const combinedGroups = combineCloseLines(fixes);
    
    for (const group of combinedGroups) {
      const first = group.at(0);
      const last = group.at(-1);
      
      if (!first || !last) {
        core.warning(`Skipping empty group for ${filePath}`);
        continue;
      }
      
      const body = buildCombinedSuggestionBody(group, true, runId, jobName);
      
      const comment: any = {
        path: filePath,
        body,
        line: last.line_end
      };

      if (first.line_start !== last.line_end) {
        comment.start_line = first.line_start;
      }

      comments.push(comment);
    }
  }

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
    return { posted: fixSuggestions.length };
  } catch (error: any) {
    if (error?.status === 403 || error?.message?.includes('Resource not accessible')) {
      const errorMsg = "Missing 'pull-requests: write' permission";
      core.warning(`⚠️  Cannot post PR review comments: ${errorMsg}. Add it to your workflow to enable inline fix suggestions.`);
      return { posted: 0, error: errorMsg };
    } else if (error?.status === 422 || error?.message?.includes('Path could not be resolved')) {
      core.info(`Files not in PR diff, falling back to PR comment`);
      const fallbackResult = await postPRCommentFallback(octokit, context, fixSuggestions, pullNumber, apiResponse, cleanupOldComments);
      return fallbackResult;
    } else {
      const errorMsg = toErrorMessage(error);
      core.warning(`Failed to post PR review comments: ${errorMsg}`);
      return { posted: 0, error: errorMsg };
    }
  }
}

async function postPRCommentFallback(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  fixSuggestions: FixSuggestion[],
  pullNumber: number,
  apiResponse?: any,
  cleanupOldComments: boolean = false
): Promise<PostingResult> {
  const { owner, repo } = context.repo;
  const runId = context.runId;
  const jobName = context.job;

  if (cleanupOldComments) {
    await cleanupOldPRComments(octokit, owner, repo, pullNumber, runId);
  }

  let body = `## 🤖 WhyDidItFail\n\n`;
  body += `### 🔧 Suggested Fixes\n\n`;
  body += `> These apply to files **not modified in this PR**, so they're listed here instead of inline suggestions.\n\n`;
  
  if (apiResponse) {
    const remaining = apiResponse.remaining ?? 0;
    const limit = apiResponse.limit ?? 35;
    
    let usageText = `📊 **Usage:** ${remaining} / ${limit} remaining`;
    
    if (apiResponse.reset_at) {
      const resetDate = new Date(apiResponse.reset_at);
      usageText += ` · 🔁 resets ${resetDate.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric'
      })}`;
    }
    
    body += `${usageText}\n\n`;
  }
  
  body += `---\n\n`;

  const groupedFixes = groupFixesByFile(fixSuggestions);

  for (const [filePath, fixes] of Object.entries(groupedFixes)) {
    body += `#### 📄 \`${filePath}\`\n\n`;
    
    const combinedGroups = combineCloseLines(fixes);
    
    for (const group of combinedGroups) {
      if (group.length === 1) {
        body += buildFallbackSuggestionBody(group[0], filePath);
      } else {
        body += buildCombinedFallbackBody(group, filePath);
      }
      body += '\n\n';
    }
    
    body += '---\n\n';
  }

  body += `<sub>Job: ${jobName} · Run #${runId} · Powered by [WhyDidItFail](https://github.com/marketplace/actions/whydiditfail)</sub>\n\n`;
  body += WDF_MARKER;

  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body
    });

    core.info(`Posted fix suggestions as PR comment #${pullNumber}`);
    return { posted: fixSuggestions.length };
  } catch (error) {
    const errorMsg = toErrorMessage(error);
    core.warning(`Failed to post PR comment: ${errorMsg}`);
    return { posted: 0, error: errorMsg };
  }
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'rb': 'ruby',
    'php': 'php',
    'cs': 'csharp',
    'swift': 'swift',
    'kt': 'kotlin'
  };
  return langMap[ext || ''] || 'text';
}

async function cleanupOldPRComments(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  currentRunId: number
): Promise<void> {
  try {
    const comments = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100
    });

    const botComments = comments.data.filter(comment => 
      comment.user?.type === 'Bot' && 
      comment.body?.includes(WDF_MARKER)
    );

    let deletedCount = 0;
    for (const comment of botComments) {
      const runIdMatch = comment.body?.match(/Run #(\d+)/);
      const commentRunId = runIdMatch ? parseInt(runIdMatch[1], 10) : null;
      
      if (commentRunId !== null && commentRunId !== currentRunId) {
        try {
          await octokit.rest.issues.deleteComment({
            owner,
            repo,
            comment_id: comment.id
          });
          deletedCount++;
          core.info(`Deleted old PR comment #${comment.id} from run #${commentRunId}`);
        } catch (deleteError) {
          core.warning(`Failed to delete comment #${comment.id}: ${deleteError}`);
        }
      }
    }
    
    if (deletedCount > 0) {
      core.info(`Cleaned up ${deletedCount} old WhyDidItFail PR comment(s)`);
    }
  } catch (error) {
    core.warning(`Failed to cleanup old PR comments: ${error}`);
  }
}

async function cleanupOldReviewComments(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  currentRunId: number
): Promise<void> {
  try {
    const reviewComments = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100
    });

    const botReviewComments = reviewComments.data.filter(comment => 
      comment.user?.type === 'Bot' && 
      comment.body?.includes(WDF_MARKER)
    );

    let deletedCount = 0;
    for (const comment of botReviewComments) {
      const runIdMatch = comment.body?.match(/Run #(\d+)/);
      const commentRunId = runIdMatch ? parseInt(runIdMatch[1], 10) : null;
      
      if (commentRunId !== null && commentRunId !== currentRunId) {
        try {
          await octokit.rest.pulls.deleteReviewComment({
            owner,
            repo,
            comment_id: comment.id
          });
          deletedCount++;
          core.info(`Deleted old inline review comment #${comment.id} from run #${commentRunId}`);
        } catch (deleteError) {
          core.warning(`Failed to delete review comment #${comment.id}: ${deleteError}`);
        }
      }
    }
    
    if (deletedCount > 0) {
      core.info(`Cleaned up ${deletedCount} old WhyDidItFail inline review comment(s)`);
    }
  } catch (error) {
    core.warning(`Failed to cleanup old review comments: ${error}`);
  }
}

async function postCommitComments(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  fixSuggestions: FixSuggestion[],
  commitSha: string
): Promise<PostingResult> {
  const { owner, repo } = context.repo;

  let posted = 0;
  const errors: string[] = [];

  for (const fix of fixSuggestions) {
    try {
      const body = buildFallbackSuggestionBody(fix, fix.path);

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
      const errorMsg = toErrorMessage(error);
      core.warning(`Failed to post commit comment for ${fix.path}: ${errorMsg}`);
      if (errors.length === 0) {
        errors.push(errorMsg);
      }
    }
  }

  if (posted > 0) {
    core.info(`Posted ${posted} fix suggestions as commit comments`);
  }

  return { 
    posted, 
    error: errors.length > 0 ? errors[0] : undefined 
  };
}

function groupFixesByFile(fixes: FixSuggestion[]): Record<string, FixSuggestion[]> {
  const grouped: Record<string, FixSuggestion[]> = {};
  
  for (const fix of fixes) {
    if (!grouped[fix.path]) {
      grouped[fix.path] = [];
    }
    grouped[fix.path].push(fix);
  }
  
  for (const path in grouped) {
    grouped[path].sort((a, b) => a.line_start - b.line_start);
  }
  
  return grouped;
}

function combineCloseLines(fixes: FixSuggestion[]): FixSuggestion[][] {
  if (fixes.length === 0) return [];
  if (fixes.length === 1) return [[fixes[0]]];
  
  const groups: FixSuggestion[][] = [];
  let currentGroup: FixSuggestion[] = [fixes[0]];
  
  for (let i = 1; i < fixes.length; i++) {
    const prev = currentGroup.at(-1);
    const curr = fixes[i];
    
    if (!prev) {
      currentGroup = [curr];
      continue;
    }
    
    if (curr.line_start - prev.line_end <= 5) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  
  return groups;
}

function buildCombinedSuggestionBody(fixes: FixSuggestion[], useSuggestionSyntax: boolean, runId: number, jobName: string): string {
  if (fixes.length === 1) {
    return buildInlineSuggestionBody(fixes[0], runId, jobName);
  }
  
  let body = '';
  
  fixes.forEach((fix, i) => {
    if (i > 0) body += '\n---\n\n';
    body += buildInlineSuggestionBody(fix, runId, jobName);
  });
  
  return body;
}

function buildInlineSuggestionBody(fix: FixSuggestion, runId: number, jobName: string): string {
  const errorCode = fix.error_code || 'Error';
  const title = fix.title || 'Suggested fix';
  const rationale = fix.rationale || 'This change should resolve the error.';
  const confidence = fix.confidence >= 0.85 ? 'High' : fix.confidence >= 0.65 ? 'Medium' : 'Low';
  const evidence = fix.evidence || `${fix.path}:${fix.line_start}`;
  const tip = fix.tip || '';
  const displayJobName = fix.jobName || jobName;

  let body = `## 🤖 WhyDidItFail\n\n`;
  body += `### ✅ Fix ${errorCode}: ${title}\n\n`;
  body += `${rationale}\n\n`;
  body += '```suggestion\n';
  body += fix.replacement;
  body += '\n```\n\n';
  
  body += '<details>\n';
  body += '  <summary><strong>Details</strong></summary>\n\n';
  body += `**Confidence:** ${confidence}\n\n`;
  body += `**Evidence:** ${evidence}\n\n`;
  body += '</details>\n';
  
  if (tip) {
    body += `\n💡 **Tip:** ${tip}\n`;
  }
  
  body += `\n---\n\n`;
  body += `<sub>Job: ${displayJobName} · Run #${runId} · Powered by [WhyDidItFail](https://github.com/marketplace/actions/whydiditfail)</sub>\n\n`;
  body += WDF_MARKER;

  return body;
}

function buildFallbackSuggestionBody(fix: FixSuggestion, filePath: string): string {
  const title = fix.title || 'Fix compilation error';
  const rationale = fix.rationale || 'This change resolves the error.';
  const language = detectLanguage(filePath);
  const context = github.context;
  const { owner, repo } = context.repo;
  const commitSha = context.sha;
  
  const fileLink = `https://github.com/${owner}/${repo}/blob/${commitSha}/${filePath}#L${fix.line_start}`;

  let body = `**Issue:** ${title}\n\n`;
  body += `**Fix:** ${rationale}\n\n`;
  body += `**Location:** [\`${filePath}:${fix.line_start}\`](${fileLink})\n\n`;
  body += `\`\`\`${language}\n`;
  body += fix.replacement;
  body += '\n```';
  
  return body;
}

function buildCombinedFallbackBody(fixes: FixSuggestion[], filePath: string): string {
  let body = '';
  
  fixes.forEach((fix, i) => {
    if (i > 0) body += '\n\n';
    body += buildFallbackSuggestionBody(fix, filePath);
  });
  
  return body;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }
  return String(error);
}
