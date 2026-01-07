import * as core from "@actions/core";

export interface RenderContext {
  serverUrl: string;
  repository: string;
  sha: string;
}

export function formatSummary(explanation: any, ctx?: RenderContext): string {
  const e = explanation ?? {};
  
  if (e.summary && e.jobs && Array.isArray(e.jobs)) {
    return formatMultiJobSummary(e, ctx);
  }
  
  if (e.skipped) {
    let summary = "# ⏭️ Analysis Skipped\n\n";
    
    if (e.code === "LOW_CONFIDENCE") {
      summary += "### 📊 Low Confidence Detection\n\n";
      
      if (e.confidenceScore !== undefined) {
        const scorePercent = Math.round(e.confidenceScore * 100);
        summary += `**Confidence Score:** ${scorePercent}%\n\n`;
      }
      
      if (e.reason) {
        summary += `**Reason:** ${e.reason}\n\n`;
      }
      
      if (e.autoFetch?.attempted) {
        summary += "### 🔄 Auto-Fetch Attempt\n\n";
        summary += "The service attempted to gather more context:\n\n";
        
        const fetched = e.autoFetch.fetched || {};
        summary += `- **Job Logs:** ${fetched.jobLogs ? '✅ Fetched' : '❌ Not available'}\n`;
        summary += `- **Workflow YAML:** ${fetched.workflow ? '✅ Fetched' : '❌ Not available'}\n\n`;
        
        if (e.autoFetch.errors && e.autoFetch.errors.length > 0) {
          summary += "**Errors:**\n";
          e.autoFetch.errors.forEach((err: string) => {
            summary += `- ${err}\n`;
          });
          summary += "\n";
        }
      }
      
      if (e.suggestions && e.suggestions.length > 0) {
        summary += "### 💡 Suggestions\n\n";
        e.suggestions.forEach((suggestion: string) => {
          summary += `- ${suggestion}\n`;
        });
        summary += "\n";
      }
    }
    
    summary += "---\n\n";
    summary += '<sub>Powered by <a href="https://github.com/marketplace/actions/whydiditfail">WhyDidItFail</a></sub>\n';
    
    return summary;
  }
  
  if (e.rate_limited) {
    let summary = "# 🚦 Rate Limit Reached\n\n";
    summary += "> ⚠️ **WhyDidItFail has reached its analysis limit for this repository.**\n\n";
    
    if (e.limit) {
      summary += "| Metric | Value |\n";
      summary += "|--------|-------|\n";
      summary += `| **Limit** | ${e.limit} analyses per 30 days |\n`;
      summary += `| **Remaining** | ${e.remaining} |\n`;
      
      if (e.reset_at) {
        const resetDate = new Date(e.reset_at);
        summary += `| **Resets** | ${resetDate.toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short'
        })} |\n`;
      }
      summary += "\n";
    }
    
    summary += "---\n\n";
    summary += "### 💡 In the meantime\n\n";
    summary += "- Review the workflow logs manually\n";
    summary += "- Check recent similar failures for patterns\n";
    summary += "- Enable debug logging if needed\n\n";
    summary += "---\n\n";
    summary += '<sub>Powered by <a href="https://github.com/marketplace/actions/whydiditfail">WhyDidItFail</a></sub>\n';
    
    return summary;
  }

  const confidence = typeof e.confidence === "number" ? e.confidence : 0;
  const confidencePercent = Math.round(confidence * 100);
  const confidenceEmoji = confidence >= 0.85 ? "✅" : confidence >= 0.65 ? "⚠️" : "❌";

  const category = e.category ?? "unknown";
  const timeToFix = e.estimated_time_to_fix ?? "unknown";
  const remaining = e.remaining ?? 0;
  const limit = e.limit ?? 35;
  
  let resetText = "";
  if (e.reset_at) {
    const resetDate = new Date(e.reset_at);
    resetText = ` · 🔁 resets ${resetDate.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric'
    })}`;
  }

  // Determine title based on category and root cause
  let title = "Failure Analysis";
  if (e.root_cause) {
    const rootCause = String(e.root_cause).split('\n')[0].trim();
    if (rootCause.length > 0 && rootCause.length < 80) {
      title = rootCause;
    }
  }

  let summary = title === "Failure Analysis" 
    ? `## 🔎 Failure Analysis\n\n`
    : `## 🔎 Failure Analysis · ${title}\n\n`;
  
  summary += `${confidenceEmoji} **Confidence:** ${confidencePercent}% · **Category:** \`${category}\` · **ETA:** ${timeToFix} · 📊 **Usage:** ${remaining} / ${limit} remaining${resetText}\n\n`;
  
  if (e.grace_period?.active) {
    summary += `> ⚠️ **Grace Period Active:** You've exceeded your monthly limit but have **${e.grace_period.remaining}** grace analyses remaining.\n\n`;
  }

  summary += "---\n\n";

  summary += "### ❌ Root Cause\n";
  const rootCause = renderMd(e.root_cause ?? "Unknown");
  const rootCauseLines = rootCause.split('\n');
  if (rootCauseLines.length > 0) {
    summary += `**${rootCauseLines[0]}**\n\n`;
    if (rootCauseLines.length > 1) {
      summary += rootCauseLines.slice(1).join('\n') + "\n\n";
    }
  } else {
    summary += "**Unknown**\n\n";
  }

  summary += "---\n\n";

  // Affected files section
  const locs = Array.isArray(e.locations) ? e.locations : null;
  if (locs && locs.length > 0) {
    summary += "<details>\n";
    summary += `  <summary><strong>📍 Affected files (${locs.length})</strong></summary>\n\n`;
    summary += `${renderWhere(e, ctx)}\n\n`;
    summary += "</details>\n\n";
    summary += "---\n\n";
  } else if (e.where) {
    summary += "<details>\n";
    summary += "  <summary><strong>📍 Affected files</strong></summary>\n\n";
    summary += `${renderMd(e.where)}\n\n`;
    summary += "</details>\n\n";
    summary += "---\n\n";
  }

  summary += "### ✅ Recommended Fixes\n";
  const fixes = Array.isArray(e.fixes) ? e.fixes : ["No fix suggestions"];
  
  if (fixes.length > 0 && typeof fixes[0] === 'object' && 'description' in fixes[0]) {
    fixes.forEach((fix: any, i: number) => {
      summary += `${i + 1}. ${renderMdInline(fix.description ?? fix)}\n`;
    });
  } else {
    fixes.forEach((fix: string, i: number) => {
      summary += `${i + 1}. ${renderMdInline(fix)}\n`;
    });
  }
  summary += "\n";

  summary += "---\n\n";

  // Fix suggestions section
  const fixSuggestions = Array.isArray(e.fix_suggestions) ? e.fix_suggestions : [];
  if (fixSuggestions.length > 0) {
    summary += "### 🔧 Code Fix Suggestions\n\n";
    
    const isPR = process.env.GITHUB_EVENT_NAME === 'pull_request';
    const prNumber = process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)\//)?.[1];
    const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
    const repository = process.env.GITHUB_REPOSITORY;
    
    if (isPR && prNumber && repository) {
      const prUrl = `${serverUrl}/${repository}/pull/${prNumber}/files`;
      summary += `> 💡 **[View inline suggestions in the PR →](${prUrl})** Check the \"Files changed\" tab for one-click fixes.\n\n`;
    } else if (isPR) {
      summary += "> 💡 **Inline suggestions posted to the PR.** Check the \"Files changed\" tab for one-click fixes.\n\n";
    } else {
      const sha = process.env.GITHUB_SHA;
      if (sha && repository) {
        const commitUrl = `${serverUrl}/${repository}/commit/${sha}`;
        summary += `> 💡 **[View fix suggestions on the commit →](${commitUrl})** Check the commit comments for details.\n\n`;
      } else {
        summary += "> 💡 **Fix suggestions posted as commit comments.** Check the commit for details.\n\n";
      }
    }

    fixSuggestions.forEach((fix: any, i: number) => {
      const confidencePercent = Math.round((fix.confidence ?? 0) * 100);
      summary += `**${i + 1}. ${fix.title || 'Suggested fix'}** (${confidencePercent}% confidence)\n\n`;
      
      if (fix.rationale) {
        summary += `${renderMd(fix.rationale)}\n\n`;
      }
      
      summary += `**File:** \`${fix.path}\` (lines ${fix.line_start}-${fix.line_end})\n\n`;
      
      summary += "<details>\n";
      summary += "  <summary>View suggested code</summary>\n\n";
      summary += "```\n";
      summary += fix.replacement;
      summary += "\n```\n\n";
      summary += "</details>\n\n";
    });

    summary += "---\n\n";
  }

  // Error evidence section
  const snippets = Array.isArray(e.snippets) ? e.snippets : [];
  if (snippets.length > 0) {
    summary += "<details>\n";
    summary += "  <summary><strong>🧩 Error Evidence</strong></summary>\n\n";
    for (const snip of snippets) {
      if (snip.title) {
        summary += `**${renderMdInline(snip.title)}**\n\n`;
      }
      summary += "```" + (snip.language ?? "txt") + "\n";
      summary += (snip.code ?? "").trimEnd() + "\n";
      summary += "```\n\n";
    }
    summary += "</details>\n\n";
  }

  // What NOT to try section
  if (e.do_not_try && e.do_not_try !== "N/A") {
    summary += "<details>\n";
    summary += "  <summary><strong>🚫 What NOT to try</strong></summary>\n\n";
    summary += `${renderMd(e.do_not_try)}\n\n`;
    summary += "</details>\n\n";
  }

  summary += '<sub>Powered by <a href="https://github.com/marketplace/actions/whydiditfail">WhyDidItFail</a></sub>\n';

  return summary;
}

export async function postSummary(explanation: any) {
  const ctx: RenderContext | undefined = 
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_SHA
      ? {
          serverUrl: process.env.GITHUB_SERVER_URL,
          repository: process.env.GITHUB_REPOSITORY,
          sha: process.env.GITHUB_SHA
        }
      : undefined;
  
  const summaryText = formatSummary(explanation, ctx);
  await core.summary.addRaw(summaryText).write();
}

function renderMd(s: any): string {
  return String(s ?? "").replace(/\u0000/g, "");
}

function renderMdInline(s: any): string {
  return String(s ?? "").replace(/\r?\n/g, " ").trim();
}

function renderWhere(e: any, ctx?: RenderContext): string {
  const locs = Array.isArray(e.locations) ? e.locations : null;
  if (locs && locs.length > 0 && ctx) {
    const links = locs
      .map((loc: any) => formatLocationLink(loc, ctx))
      .filter((link: string) => link.length > 0);
    if (links.length > 0) {
      return links.join("\n");
    }
  }
  return renderMd(e.where ?? "Unknown");
}

function formatLocationLink(loc: any, ctx: RenderContext): string {
  let path = String(loc.path ?? "");
  const lineStart = Number(loc.line_start ?? loc.line ?? 0) || 0;
  const lineEnd = Number(loc.line_end ?? 0) || 0;

  const isEvalOrSpecial = path.includes('[eval]') || path.includes('<') || path.includes('>');
  
  // Skip [eval] and other special non-file locations completely
  if (isEvalOrSpecial) {
    return '';
  }
  
  // Extract relative path from workspace absolute paths
  // Pattern: /home/runner/work/{repo-name}/{repo-name}/{relative-path}
  const workspaceMatch = path.match(/\/home\/runner\/work\/[^\/]+\/[^\/]+\/(.+)$/);
  if (workspaceMatch) {
    path = workspaceMatch[1];
  } else if (path.startsWith('/')) {
    // For other absolute paths, just use the filename
    const filename = path.split('/').pop() || path;
    const labelParts = [filename];
    if (lineStart) {
      labelParts.push(`line ${lineStart}` + (lineEnd > lineStart ? `-${lineEnd}` : ""));
    }
    if (loc.column) {
      labelParts.push(`col ${loc.column}`);
    }
    return `- ${labelParts.join(", ")}`;
  }

  // Create a link for all relative paths
  path = path.replace(/^\.?\//, "");

  const anchor =
    lineStart > 0
      ? (lineEnd > lineStart ? `#L${lineStart}-L${lineEnd}` : `#L${lineStart}`)
      : "";

  const url = `${ctx.serverUrl}/${ctx.repository}/blob/${ctx.sha}/${path}${anchor}`;

  const labelParts = [path];
  if (lineStart) {
    labelParts.push(`L${lineStart}` + (lineEnd > lineStart ? `-L${lineEnd}` : ""));
  }
  if (loc.column) {
    labelParts.push(`C${loc.column}`);
  }

  return `- [${labelParts.join(": ")}](${url})`;
}

function formatMultiJobSummary(result: any, ctx?: RenderContext): string {
  const summary = result.summary || {};
  const jobs = result.jobs || [];
  const rootCauses = result.rootCauses || [];

  let output = "## 🔎 Multi-Job Failure Analysis\n\n";
  
  // Usage info at the top
  const successfulAnalyses = jobs.filter((j: any) => j.success && !j.skipped && !j.isCascadingFailure).length;
  output += `🔢 **Analyses Used:** ${successfulAnalyses} this run`;
  if (summary.jobsSkippedCascading > 0) {
    output += ` (${summary.jobsSkippedCascading} skipped as cascading failures)`;
  }
  output += `\n\n`;
  output += "---\n\n";

  if (rootCauses.length > 0) {
    output += `## 🎯 Root Causes Found: ${rootCauses.length}\n\n`;

    rootCauses.forEach((rc: any, i: number) => {
      output += `### ${i + 1}. ${rc.description}\n\n`;
      
      // Get details from the first affected job
      const firstJobName = rc.affectedJobs?.[0];
      const firstJob = jobs.find((j: any) => j.jobName === firstJobName);
      
      output += `**Affected Jobs:** ${rc.affectedJobs.join(', ')}`;
      
      if (firstJob) {
        if (firstJob.category) {
          output += ` · **Category:** \`${firstJob.category}\``;
        }
        
        // Get first affected file
        const locs = Array.isArray(firstJob.locations) ? firstJob.locations : [];
        if (locs.length > 0 && ctx) {
          const firstLoc = locs[0];
          const repoUrl = `${ctx.serverUrl}/${ctx.repository}`;
          const lineStart = firstLoc.line_start || firstLoc.line;
          const lineEnd = firstLoc.line_end;
          const anchor = lineStart ? (lineEnd && lineEnd > lineStart ? `#L${lineStart}-L${lineEnd}` : `#L${lineStart}`) : '';
          const fileLink = `${repoUrl}/blob/${ctx.sha || 'main'}/${firstLoc.path}${anchor}`;
          const displayPath = lineStart ? `${firstLoc.path}:${lineStart}` : firstLoc.path;
          output += ` · **Affected File:** [${displayPath}](${fileLink})`;
        } else if (locs.length > 0) {
          output += ` · **Affected File:** \`${locs[0].path}\``;
        }
      }
      
      output += "\n\n";
      
      if (rc.fixes && rc.fixes.length > 0) {
        output += "**Recommended Fixes:**\n";
        rc.fixes.forEach((fix: string, j: number) => {
          output += `${j + 1}. ${renderMdInline(fix)}\n`;
        });
        output += "\n";
      }
      
      output += "---\n\n";
    });
  }

  output += "## 📋 Individual Job Results\n\n";
  output += "> Expand each job below for detailed analysis, code suggestions, and error evidence.\n\n";

  jobs.forEach((job: any, idx: number) => {
    if (idx > 0) {
      output += "---\n\n";
    }
    
    output += `<details>\n`;
    
    if (job.isCascadingFailure) {
      output += `<summary><strong>Job: ${job.jobName}</strong> (⛓️ Cascading Failure)</summary>\n\n`;
      output += `> This job failed because a previous required job failed.\n\n`;
    } else if (job.skipped) {
      output += `<summary><strong>Job: ${job.jobName}</strong> (⏭️ Skipped)</summary>\n\n`;
      output += `**Reason:** ${job.skipReason || 'Unknown'}\n\n`;
    } else if (!job.success) {
      output += `<summary><strong>Job: ${job.jobName}</strong> (❌ Analysis Failed)</summary>\n\n`;
      output += `**Error:** ${job.error || 'Unknown error'}\n\n`;
    } else {
      const confidence = job.confidence || 0;
      const confidencePercent = Math.round(confidence * 100);
      const confidenceEmoji = confidence >= 0.85 ? "✅" : confidence >= 0.65 ? "⚠️" : "❌";
      const category = job.category || "unknown";
      const timeToFix = job.estimated_time_to_fix || "unknown";
      
      const rootCauseSummary = job.rootCause ? job.rootCause.split('\n')[0].substring(0, 80) : "Unknown";
      const fixCount = Array.isArray(job.fixes) ? job.fixes.length : 0;
      
      output += `<summary><strong>Job: ${job.jobName}</strong> · ${confidenceEmoji} ${confidencePercent}% · \`${category}\` · ${timeToFix}<br/>`;
      output += `<em>${rootCauseSummary}${rootCauseSummary.length >= 80 ? '...' : ''}</em> · ${fixCount} fix${fixCount !== 1 ? 'es' : ''}</summary>\n\n`;
      
      output += "### ❌ Root Cause\n";
      const rootCause = renderMd(job.rootCause || "Unknown");
      const rootCauseLines = rootCause.split('\n');
      if (rootCauseLines.length > 0) {
        output += `**${rootCauseLines[0]}**\n\n`;
        if (rootCauseLines.length > 1) {
          output += rootCauseLines.slice(1).join('\n') + "\n\n";
        }
      } else {
        output += "**Unknown**\n\n";
      }
      
      output += "---\n\n";
      
      const locs = Array.isArray(job.locations) ? job.locations : null;
      if (locs && locs.length > 0) {
        output += "<details>\n";
        output += `  <summary><strong>📍 Affected files (${locs.length})</strong></summary>\n\n`;
        output += `${renderJobWhere(job, ctx)}\n\n`;
        output += "</details>\n\n";
        output += "---\n\n";
      } else if (job.where) {
        output += "<details>\n";
        output += "  <summary><strong>📍 Affected files</strong></summary>\n\n";
        output += `${renderMd(job.where)}\n\n`;
        output += "</details>\n\n";
        output += "---\n\n";
      }
      
      output += "### ✅ Recommended Fixes\n";
      const fixes = Array.isArray(job.fixes) ? job.fixes : ["No fix suggestions"];
      
      if (fixes.length > 0 && typeof fixes[0] === 'object' && 'description' in fixes[0]) {
        fixes.forEach((fix: any, i: number) => {
          output += `${i + 1}. ${renderMdInline(fix.description ?? fix)}\n`;
        });
      } else {
        fixes.forEach((fix: string, i: number) => {
          output += `${i + 1}. ${renderMdInline(fix)}\n`;
        });
      }
      output += "\n";
      
      output += "---\n\n";
      
      const fixSuggestions = Array.isArray(job.fix_suggestions) ? job.fix_suggestions : [];
      if (fixSuggestions.length > 0) {
        output += "### 🔧 Code Fix Suggestions\n\n";
        
        fixSuggestions.forEach((fix: any, i: number) => {
          const fixConfidencePercent = Math.round((fix.confidence ?? 0) * 100);
          output += `**${i + 1}. ${fix.title || 'Suggested fix'}** (${fixConfidencePercent}% confidence)\n\n`;
          
          if (fix.rationale) {
            output += `${renderMd(fix.rationale)}\n\n`;
          }
          
          output += `**File:** \`${fix.path}\` (lines ${fix.line_start}-${fix.line_end})\n\n`;
          
          output += "<details>\n";
          output += "  <summary>View suggested code</summary>\n\n";
          output += "```\n";
          output += fix.replacement;
          output += "\n```\n\n";
          output += "</details>\n\n";
        });
        
        output += "---\n\n";
      }
      
      const snippets = Array.isArray(job.snippets) ? job.snippets : [];
      if (snippets.length > 0) {
        output += "<details>\n";
        output += "  <summary><strong>🧩 Error Evidence</strong></summary>\n\n";
        for (const snip of snippets) {
          if (snip.title) {
            output += `**${renderMdInline(snip.title)}**\n\n`;
          }
          output += "```" + (snip.language ?? "txt") + "\n";
          output += (snip.code ?? "").trimEnd() + "\n";
          output += "```\n\n";
        }
        output += "</details>\n\n";
      }
      
      if (job.do_not_try && job.do_not_try !== "N/A") {
        output += "<details>\n";
        output += "  <summary><strong>🚫 What NOT to try</strong></summary>\n\n";
        output += `${renderMd(job.do_not_try)}\n\n`;
        output += "</details>\n\n";
      }
    }
    
    output += `</details>\n\n`;
  });

  output += "---\n\n";
  output += '<sub>Powered by <a href="https://github.com/marketplace/actions/whydiditfail">WhyDidItFail</a></sub>\n';

  return output;
}

function renderJobWhere(job: any, ctx?: RenderContext): string {
  const locs = Array.isArray(job.locations) ? job.locations : null;
  if (locs && locs.length > 0 && ctx) {
    const links = locs
      .map((loc: any) => formatLocationLink(loc, ctx))
      .filter((link: string) => link.length > 0);
    if (links.length > 0) {
      return links.join("\n");
    }
  }
  return renderMd(job.where ?? "Unknown");
}
