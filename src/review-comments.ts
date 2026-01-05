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
  fixSuggestions: FixSuggestion[],
  apiResponse?: any
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
    posted = await postPRReviewComments(octokit, context, fixSuggestions, commitSha, apiResponse);
  } else {
    posted = await postCommitComments(octokit, context, fixSuggestions, commitSha);
  }

  return { posted, skipped: fixSuggestions.length - posted };
}

async function postPRReviewComments(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  fixSuggestions: FixSuggestion[],
  commitSha: string,
  apiResponse?: any
): Promise<number> {
  const { owner, repo } = context.repo;
  const pullNumber = context.payload.pull_request!.number;

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
      return await postPRCommentFallback(octokit, context, fixSuggestions, pullNumber, apiResponse);
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
  apiResponse?: any
): Promise<number> {
  const { owner, repo } = context.repo;
  const runId = context.runId;
  const jobName = context.job;

  await cleanupOldComments(octokit, owner, repo, pullNumber, runId);

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
    
    body += `\n${usageText}\n\n`;
  }
  
  body += `---\n\n`;

  const groupedFixes = groupFixesByFile(fixSuggestions);

  for (const [filePath, fixes] of Object.entries(groupedFixes)) {
    body += `#### 📄 \`${filePath}\`\n\n`;
    
    for (const fix of fixes) {
      const title = fix.title || 'Fix compilation error';
      const rationale = fix.rationale || 'This change resolves the error.';
      
      body += `**Issue:** ${title}\n\n`;
      body += `**Fix:** ${rationale}\n\n`;
      
      const language = detectLanguage(filePath);
      body += `\`\`\`${language}\n`;
      body += fix.replacement;
      body += '\n```\n\n';
    }
    
    body += '---\n\n';
  }

  body += `<sub>Job: ${jobName} · Run #${runId}</sub>`;

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

async function cleanupOldComments(
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
      comment.body?.includes('🔧 Suggested Fixes')
    );

    let deletedCount = 0;
    for (const comment of botComments) {
      const commentRunId = comment.body?.match(/Run #(\d+)/)?.[1];
      if (commentRunId && parseInt(commentRunId) !== currentRunId) {
        try {
          await octokit.rest.issues.deleteComment({
            owner,
            repo,
            comment_id: comment.id
          });
          deletedCount++;
          core.info(`Deleted old comment #${comment.id} from run #${commentRunId}`);
        } catch (deleteError) {
          core.warning(`Failed to delete comment #${comment.id}: ${deleteError}`);
        }
      }
    }
    
    if (deletedCount > 0) {
      core.info(`Cleaned up ${deletedCount} old comment(s)`);
    }
  } catch (error) {
    core.warning(`Failed to cleanup old comments: ${error}`);
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
    return buildSuggestionBody(fixes[0], useSuggestionSyntax);
  }
  
  const avgConfidence = fixes.reduce((sum, f) => sum + f.confidence, 0) / fixes.length;
  const confidencePercent = Math.round(avgConfidence * 100);
  
  let body = `## 🔧 Multiple fixes for this section\n\n`;
  body += `**Confidence:** ${confidencePercent}%\n\n`;
  
  fixes.forEach((fix, i) => {
    const fixConfidence = Math.round(fix.confidence * 100);
    body += `### ${i + 1}. ${fix.title || 'Suggested fix'} (${fixConfidence}%)\n\n`;
    body += `${fix.rationale || 'This change should resolve the error.'}\n\n`;
    
    if (useSuggestionSyntax) {
      body += '```suggestion\n';
      body += fix.replacement;
      body += '\n```\n\n';
    } else {
      body += '**Suggested code:**\n\n';
      body += '```\n';
      body += fix.replacement;
      body += '\n```\n\n';
    }
  });
  
  body += '---\n';
  body += '<sub>💡 Review these suggestions carefully before applying</sub>';
  
  return body;
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
