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
    summary += "*Powered by [WhyDidItFail](https://github.com/marketplace/actions/whydiditfail)*\n";
    
    return summary;
  }

  const confidence = typeof e.confidence === "number" ? e.confidence : 0;
  const confidencePercent = Math.round(confidence * 100);
  const emoji = confidence >= 0.85 ? "🟢" : confidence >= 0.65 ? "🟡" : "🔴";
  const label = confidence >= 0.85 ? "High" : confidence >= 0.65 ? "Medium" : "Low";

  const category = e.category ?? "Unknown";
  const timeToFix = e.estimated_time_to_fix ?? "Unknown";

  let summary = "# 🔍 Failure Analysis\n\n";
  
  summary += "<table>\n";
  summary += "<tr>\n";
  summary += `<td align="center"><strong>Confidence</strong><br/>${emoji} ${label}<br/><code>${confidencePercent}%</code></td>\n`;
  summary += `<td align="center"><strong>Category</strong><br/>📦<br/><code>${category}</code></td>\n`;
  summary += `<td align="center"><strong>Est. Time to Fix</strong><br/>⏱️<br/><code>${timeToFix}</code></td>\n`;
  summary += "</tr>\n";
  summary += "</table>\n\n";

  if (e.grace_period?.active) {
    summary += "> ⚠️ **Grace Period Active**: You've exceeded your monthly limit but have **${e.grace_period.remaining}** grace analyses remaining.\n\n";
  }

  if (confidence < 0.65) {
    summary += "> ⚠️ **Low Confidence Warning**: The analysis may be uncertain. Consider enabling debug logging for more details.\n\n";
  }

  summary += "---\n\n";
  summary += "## 🎯 Root Cause\n\n";
  summary += `> ${renderMd(e.root_cause ?? "Unknown")}\n\n`;

  summary += "## 📍 File Locations\n\n";
  summary += `${renderWhere(e, ctx)}\n\n`;

  summary += "## 🤔 Why It Failed\n\n";
  summary += `${renderMd(e.why ?? "Unknown")}\n\n`;

  summary += "## ✅ Recommended Fixes\n\n";
  const fixes = Array.isArray(e.fixes) ? e.fixes : ["No fix suggestions"];
  
  if (fixes.length > 0 && typeof fixes[0] === 'object' && 'description' in fixes[0]) {
    summary += "| # | Fix | Effort | Impact |\n";
    summary += "|---|-----|--------|--------|\n";
    fixes.forEach((fix: any, i: number) => {
      const desc = renderMdInline(fix.description ?? fix);
      const effort = fix.effort ?? "Medium";
      const impact = fix.impact ?? "Medium";
      const effortEmoji = effort === "Low" ? "🟢" : effort === "High" ? "🔴" : "🟡";
      const impactEmoji = impact === "High" ? "🟢" : impact === "Low" ? "🔴" : "🟡";
      summary += `| ${i + 1} | ${desc} | ${effortEmoji} ${effort} | ${impactEmoji} ${impact} |\n`;
    });
  } else {
    fixes.forEach((fix: string, i: number) => {
      summary += `${i + 1}. ${renderMdInline(fix)}\n`;
    });
  }
  summary += "\n";

  summary += "## ⛔ What NOT to Try\n\n";
  summary += `> ${renderMd(e.do_not_try ?? "N/A")}\n\n`;

  const snippets = Array.isArray(e.snippets) ? e.snippets : [];
  if (snippets.length > 0) {
    summary += "<details>\n";
    summary += "<summary><strong>📝 Code Context</strong> (click to expand)</summary>\n\n";
    for (const snip of snippets) {
      if (snip.title) {
        summary += `**${renderMdInline(snip.title)}**\n\n`;
      }
      summary += "```" + (snip.language ?? "") + "\n";
      summary += (snip.code ?? "").trimEnd() + "\n";
      summary += "```\n\n";
    }
    summary += "</details>\n\n";
  }

  summary += "---\n\n";
  summary += "*Powered by [WhyDidItFail](https://github.com/marketplace/actions/whydiditfail)*\n";

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
