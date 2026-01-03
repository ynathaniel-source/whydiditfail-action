import * as core from "@actions/core";

export function formatSummary(explanation: any): string {
  const e = explanation ?? {};
  const confidence = typeof e.confidence === "number" ? e.confidence : 0;

  const confidencePercent = Math.round(confidence * 100);
  const emoji = confidence >= 0.85 ? "🟢" : confidence >= 0.65 ? "🟡" : "🔴";
  const label = confidence >= 0.85 ? "High" : confidence >= 0.65 ? "Medium" : "Low";

  let summary = "## 🔍 Failure Analysis\n\n";
  summary += `**Confidence:** ${emoji} ${label} (${confidencePercent}%)\n\n`;

  if (confidence < 0.65) {
    summary += "⚠️ **Low Confidence Warning**: The analysis may be uncertain. Consider enabling debug logging for more details.\n\n";
  }

  summary += "### 🎯 Root Cause\n\n";
  summary += `${escapeMd(e.root_cause ?? "Unknown")}\n\n`;

  summary += "### 📍 Where\n\n";
  summary += `${escapeMd(e.where ?? "Unknown")}\n\n`;

  summary += "### 🤔 Why\n\n";
  summary += `${escapeMd(e.why ?? "Unknown")}\n\n`;

  summary += "### ✅ How to Fix\n\n";
  const fixes = Array.isArray(e.fixes) ? e.fixes : ["No fix suggestions"];
  fixes.forEach((fix: string, i: number) => {
    summary += `${i + 1}. ${escapeMd(fix)}\n`;
  });
  summary += "\n";

  summary += "### ⛔ What NOT to Try\n\n";
  summary += `${escapeMd(e.do_not_try ?? "N/A")}\n`;

  return summary;
}

export async function postSummary(explanation: any) {
  const summaryText = formatSummary(explanation);
  await core.summary.addRaw(summaryText).write();
}

function escapeMd(s: string) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/`/g, "\\`")
    .replace(/#/g, "\\#")
    .replace(/\|/g, "\\|")
    .replace(/[<>]/g, "");
}
