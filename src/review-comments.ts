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
  error_code?: string;
  evidence?: string;
  tip?: string;
}

export async function postFixSuggestions(
  token: string,
  fixSuggestions: FixSuggestion[],
  apiResponse?: any,
  cleanupOldComments: boolean = false
): Promise<{ posted: number; skipped: number }> {
  const context = github.context;
  const octokit = github.getOctokit(token);
  const isPR = context.payload.pull_request !== undefined;
  const commitSha = context.sha;

  if (!fixSuggestions || fixSuggestions.length === 0) {
    if (isPR && apiResponse?.root_cause) {
      const pullNumber = context.payload.pull_request!.number;
      await postNoSuggestionComment(octokit, context, pullNumber, apiResponse, cleanupOldComments);
      return { posted: 1, skipped: 0 };
    }
    return { posted: 0, skipped: 0 };
  }

  let posted = 0;
  let skipped = 0;

  if (isPR) {
    posted = await postPRReviewComments(octokit, context, fixSuggestions, commitSha, apiResponse, cleanupOldComments);
  } else {
    posted = await postCommitComments(octokit, context, fixSuggestions, commitSha);
  }

  return { posted, skipped: fixSuggestions.length - posted };
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
  
  let body = `### 🔧 Analysis Complete\n\n`;
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
  body += `<sub>Job: ${jobName} · Run #${runId} · Powered by [WhyDidItFail](https://github.com/marketplace/actions/whydiditfail)</sub>`;

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

async function postPRReviewComments(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  fixSuggestions: FixSuggestion[],
  commitSha: string,
  apiResponse?: any,
  cleanupOldComments: boolean = false
): Promise<number> {
  const { owner, repo } = context.repo;
  const pullNumber = context.payload.pull_request!.number;
  const runId = context.runId;

  if (cleanupOldComments) {
    await cleanupOldReviewComments(octokit, owner, repo, pullNumber, runId);
  }

  const groupedFixes = groupFixesByFile(fixSuggestions);
  const comments: any[] = [];

  for (const [filePath, fixes] of Object.entries(groupedFixes)) {
    const combinedGroups = combineCloseLines(fixes);
    
    for (const group of combinedGroups) {
      const body = buildCombinedSuggestionBody(group, true);
      
      const comment: any = {
        path: filePath,
        body,
        line: group[group.length - 1].line_end
      };

      if (group[0].line_start !== group[group.length - 1].line_end) {
        comment.start_line = group[0].line_start;
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
    return fixSuggestions.length;
  } catch (error: any) {
    if (error?.status === 403 || error?.message?.includes('Resource not accessible')) {
      core.warning(`⚠️  Cannot post PR review comments: missing 'pull-requests: write' permission. Add it to your workflow to enable inline fix suggestions.`);
      return 0;
    } else if (error?.status === 422 || error?.message?.includes('Path could not be resolved')) {
      core.info(`Files not in PR diff, falling back to PR comment`);
      return await postPRCommentFallback(octokit, context, fixSuggestions, pullNumber, apiResponse, cleanupOldComments);
    } else {
      core.warning(`Failed to post PR review comments: ${error}`);
      return 0;
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
): Promise<number> {
  const { owner, repo } = context.repo;
  const runId = context.runId;
  const jobName = context.job;

  if (cleanupOldComments) {
    await cleanupOldPRComments(octokit, owner, repo, pullNumber, runId);
  }

  let body = `### 🔧 Suggested Fixes\n\n`;
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

  body += `<sub>Job: ${jobName} · Run #${runId} · Powered by [WhyDidItFail](https://github.com/marketplace/actions/whydiditfail)</sub>`;

  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body
    });

    core.info(`Posted fix suggestions as PR comment #${pullNumber}`);
    return fixSuggestions.length;
  } catch (error) {
    core.warning(`Failed to post PR comment: ${error}`);
    return 0;
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
      (comment.body?.includes('🔧 Suggested Fixes') || comment.body?.includes('🔧 Analysis Complete'))
    );

    let deletedCount = 0;
    for (const comment of botComments) {
      try {
        await octokit.rest.issues.deleteComment({
          owner,
          repo,
          comment_id: comment.id
        });
        deletedCount++;
        core.info(`Deleted old PR comment #${comment.id}`);
      } catch (deleteError) {
        core.warning(`Failed to delete comment #${comment.id}: ${deleteError}`);
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
      (comment.body?.includes('✅ Fix') || comment.body?.includes('WhyDidItFail'))
    );

    let deletedCount = 0;
    for (const comment of botReviewComments) {
      try {
        await octokit.rest.pulls.deleteReviewComment({
          owner,
          repo,
          comment_id: comment.id
        });
        deletedCount++;
        core.info(`Deleted old inline review comment #${comment.id}`);
      } catch (deleteError) {
        core.warning(`Failed to delete review comment #${comment.id}: ${deleteError}`);
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
): Promise<number> {
  const { owner, repo } = context.repo;

  let posted = 0;

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
      core.warning(`Failed to post commit comment for ${fix.path}: ${error}`);
    }
  }

  if (posted > 0) {
    core.info(`Posted ${posted} fix suggestions as commit comments`);
  }

  return posted;
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
    const prev = currentGroup[currentGroup.length - 1];
    const curr = fixes[i];
    
    if (curr.line_start - prev.line_end <= 5) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  
  groups.push(currentGroup);
  return groups;
}

function buildCombinedSuggestionBody(fixes: FixSuggestion[], useSuggestionSyntax: boolean): string {
  if (fixes.length === 1) {
    return buildInlineSuggestionBody(fixes[0]);
  }
  
  let body = '';
  
  fixes.forEach((fix, i) => {
    if (i > 0) body += '\n---\n\n';
    body += buildInlineSuggestionBody(fix);
  });
  
  return body;
}

function buildInlineSuggestionBody(fix: FixSuggestion): string {
  const errorCode = fix.error_code || 'Error';
  const title = fix.title || 'Suggested fix';
  const rationale = fix.rationale || 'This change should resolve the error.';
  const confidence = fix.confidence >= 0.85 ? 'High' : fix.confidence >= 0.65 ? 'Medium' : 'Low';
  const evidence = fix.evidence || `${fix.path}:${fix.line_start}`;
  const tip = fix.tip || '';

  let body = `### ✅ Fix ${errorCode}: ${title}\n\n`;
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
  body += `<sub>Powered by [WhyDidItFail](https://github.com/marketplace/actions/whydiditfail)</sub>`;

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
