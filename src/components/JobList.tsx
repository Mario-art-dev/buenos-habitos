"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import JobStatusBadge from "./JobStatusBadge";

interface JobSummary {
  id: string;
  sourceUrl: string | null;
  productName: string | null;
  sourceTitle: string | null;
  status: string;
  createdAt: string;
  clips: { id: string; viralityScore: number; status: string }[];
}

export default function JobList({
  mode,
  emptyMessage = "Todavía no has generado ningún short. Pega un enlace arriba para empezar.",
}: {
  mode?: "SINGLE" | "RANKING" | "PRODUCT" | "SONG";
  emptyMessage?: string;
}) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      const qs = mode ? `?mode=${mode}` : "";
      const res = await fetch(`/api/jobs${qs}`);
      if (!res.ok || stop) return;
      const data = await res.json();
      setJobs(data.jobs);
      setLoaded(true);
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, [mode]);

  if (loaded && jobs.length === 0) {
    return <p className="mt-10 text-center text-sm text-slate-500">{emptyMessage}</p>;
  }

  return (
    <div className="mt-8 space-y-3">
      {jobs.map((job) => (
        <Link
          key={job.id}
          href={`/jobs/${job.id}`}
          className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 transition hover:border-brand-500/50"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-100">
              {job.sourceTitle ?? job.productName ?? job.sourceUrl ?? "Sin título"}
            </p>
            {job.sourceUrl && <p className="truncate text-xs text-slate-500">{job.sourceUrl}</p>}
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-3">
            {job.clips.length > 0 && (
              <span className="text-xs text-slate-400">{job.clips.length} vídeos</span>
            )}
            <JobStatusBadge status={job.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}
