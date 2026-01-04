import * as core from "@actions/core";
export function formatSummary(explanation, ctx) {
    const e = explanation ?? {};
    if (e.rate_limited) {
        let summary = "## 🚦 Rate Limit Reached\n\n";
        summary += "⚠️ **WhyDidItFail has reached its analysis limit for this repository.**\n\n";
        if (e.limit) {
            summary += `**Limit:** ${e.limit} analyses per 30 days\n\n`;
            summary += `**Remaining:** ${e.remaining}\n\n`;
        }
        if (e.reset_at) {
            const resetDate = new Date(e.reset_at);
            summary += `**Resets:** ${resetDate.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZoneName: 'short'
            })}\n\n`;
        }
        summary += "---\n\n";
        summary += "💡 **In the meantime:**\n";
        summary += "- Review the workflow logs manually\n";
        summary += "- Check recent similar failures for patterns\n";
        summary += "- Enable debug logging if needed\n";
        return summary;
    }
    const confidence = typeof e.confidence === "number" ? e.confidence : 0;
    const confidencePercent = Math.round(confidence * 100);
    const emoji = confidence >= 0.85 ? "🟢" : confidence >= 0.65 ? "🟡" : "🔴";
    const label = confidence >= 0.85 ? "High" : confidence >= 0.65 ? "Medium" : "Low";
    let summary = "## 🔍 Failure Analysis\n\n";
    summary += `**Confidence:** ${emoji} ${label} (${confidencePercent}%)\n\n`;
    if (e.grace_period?.active) {
        summary += `⚠️ **Grace Period**: You've exceeded your monthly limit but have ${e.grace_period.remaining} grace analyses remaining.\n\n`;
    }
    if (confidence < 0.65) {
        summary += "⚠️ **Low Confidence Warning**: The analysis may be uncertain. Consider enabling debug logging for more details.\n\n";
    }
    summary += "### 🎯 Root Cause\n\n";
    summary += `${renderMd(e.root_cause ?? "Unknown")}\n\n`;
    summary += "### 📍 Where\n\n";
    summary += `${renderWhere(e, ctx)}\n\n`;
    summary += "### 🤔 Why\n\n";
    summary += `${renderMd(e.why ?? "Unknown")}\n\n`;
    summary += "### ✅ How to Fix\n\n";
    const fixes = Array.isArray(e.fixes) ? e.fixes : ["No fix suggestions"];
    fixes.forEach((fix, i) => {
        summary += `${i + 1}. ${renderMdInline(fix)}\n`;
    });
    summary += "\n";
    summary += "### ⛔ What NOT to Try\n\n";
    summary += `${renderMd(e.do_not_try ?? "N/A")}\n\n`;
    const snippets = Array.isArray(e.snippets) ? e.snippets : [];
    if (snippets.length > 0) {
        summary += "### 📝 Code Context\n\n";
        for (const snip of snippets) {
            if (snip.title) {
                summary += `**${renderMdInline(snip.title)}**\n\n`;
            }
            summary += "```" + (snip.language ?? "") + "\n";
            summary += (snip.code ?? "").trimEnd() + "\n";
            summary += "```\n\n";
        }
    }
    return summary;
}
export async function postSummary(explanation) {
    const ctx = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_SHA
        ? {
            serverUrl: process.env.GITHUB_SERVER_URL,
            repository: process.env.GITHUB_REPOSITORY,
            sha: process.env.GITHUB_SHA
        }
        : undefined;
    const summaryText = formatSummary(explanation, ctx);
    await core.summary.addRaw(summaryText).write();
}
function renderMd(s) {
    return String(s ?? "").replace(/\u0000/g, "");
}
function renderMdInline(s) {
    return String(s ?? "").replace(/\r?\n/g, " ").trim();
}
function renderWhere(e, ctx) {
    const locs = Array.isArray(e.locations) ? e.locations : null;
    if (locs && locs.length > 0 && ctx) {
        const links = locs
            .map((loc) => formatLocationLink(loc, ctx))
            .filter((link) => link.length > 0);
        if (links.length > 0) {
            return links.join("\n");
        }
    }
    return renderMd(e.where ?? "Unknown");
}
function formatLocationLink(loc, ctx) {
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
    }
    else if (path.startsWith('/')) {
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
    const anchor = lineStart > 0
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
