import clsx from "clsx";

const LABELS: Record<string, string> = {
  PENDING: "En cola",
  DOWNLOADING: "Descargando",
  TRANSCRIBING: "Transcribiendo",
  ANALYZING: "Analizando con IA",
  CLIPPING: "Generando shorts",
  DONE: "Listo",
  FAILED: "Error",
};

export default function JobStatusBadge({ status }: { status: string }) {
  const done = status === "DONE";
  const failed = status === "FAILED";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        done && "bg-emerald-500/15 text-emerald-400",
        failed && "bg-red-500/15 text-red-400",
        !done && !failed && "bg-brand-500/15 text-brand-400"
      )}
    >
      {!done && !failed && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />}
      {LABELS[status] ?? status}
    </span>
  );
}
