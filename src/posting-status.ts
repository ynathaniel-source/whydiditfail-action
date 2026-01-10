export type AttemptStatus =
  | { ok: true }
  | { ok: false; reason: string };

export interface SuggestionsStatus {
  attempted: boolean;
  total: number;
  posted: number;
  skipped: number;
  status: AttemptStatus;
}

export interface CommentStatus {
  attempted: boolean;
  status: AttemptStatus;
}

export interface PostingStatus {
  analysisCompleted: boolean;
  suggestions?: SuggestionsStatus;
  prComment?: CommentStatus;
}
