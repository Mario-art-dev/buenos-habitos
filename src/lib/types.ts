export type JobStatus =
  | "PENDING"
  | "DOWNLOADING"
  | "TRANSCRIBING"
  | "ANALYZING"
  | "CLIPPING"
  | "DONE"
  | "FAILED";

export type ClipStatus = "PENDING" | "RENDERING" | "READY" | "FAILED";

export type Platform = "YOUTUBE" | "TIKTOK";

export type PublicationStatus = "PENDING" | "UPLOADING" | "PUBLISHED" | "DRAFT" | "FAILED";
