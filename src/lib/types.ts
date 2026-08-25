export type JobStatus =
  | "PENDING"
  | "DOWNLOADING"
  | "TRANSCRIBING"
  | "ANALYZING"
  | "CLIPPING"
  | "DONE"
  | "FAILED";

export type ClipStatus = "PENDING" | "RENDERING" | "READY" | "FAILED" | "PUBLISHED";

export type Platform = "YOUTUBE" | "TIKTOK";

export type PublicationStatus = "PENDING" | "UPLOADING" | "PUBLISHED" | "DRAFT" | "FAILED";

export type JobMode = "SINGLE" | "RANKING";

export type AutoPublishMode = "OFF" | "INTERVAL" | "WINDOW";

export type AutoPublishTaskStatus = "PENDING" | "DONE" | "FAILED";
