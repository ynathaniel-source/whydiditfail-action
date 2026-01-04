import * as core from "@actions/core";

export interface RenderContext {
  serverUrl: string;
  repository: string;
  sha: string;
}

export function formatSummary(explanation: any, ctx?: RenderContext): string {
  const e = explanation ?? {};
  
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

  let summary = `## 🔎 Failure Analysis · ${title}\n\n`;
  
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
