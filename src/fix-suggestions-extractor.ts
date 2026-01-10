import { FixSuggestion } from "./review-comments.js";

export interface FixSuggestionWithJob extends FixSuggestion {
  jobName?: string;
}

export function extractFixSuggestions(result: any): FixSuggestionWithJob[] {
  const topLevel = Array.isArray(result?.fix_suggestions) ? result.fix_suggestions : [];

  const fromJobs = Array.isArray(result?.jobs)
    ? result.jobs.flatMap((job: any) => {
        const suggestions = Array.isArray(job?.fix_suggestions) ? job.fix_suggestions : [];
        return suggestions.map((s: any) => ({
          ...s,
          jobName: job.jobName || job.name
        }));
      })
    : [];

  const combined = fromJobs.length > 0 ? fromJobs : topLevel;

  return dedupeFixSuggestions(combined);
}

function dedupeFixSuggestions(suggestions: FixSuggestionWithJob[]): FixSuggestionWithJob[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = `${s.path}:${s.line_start}-${s.line_end}:${s.replacement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
