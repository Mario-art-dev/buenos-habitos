"use client";

import { useEffect, useState } from "react";
import JobStatusBadge from "@/components/JobStatusBadge";
import ClipCard, { ClipData } from "@/components/ClipCard";

interface JobData {
  id: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  productName: string | null;
  status: string;
  statusMessage: string | null;
  error: string | null;
  clips: ClipData[];
}

export default function JobDetailClient({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobData | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok || stop) return;
      const data = await res.json();
      setJob(data.job);
    }
    load();
    const interval = setInterval(() => {
      if (job?.status === "DONE" || job?.status === "FAILED") return;
      load();
    }, 4000);
    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, [jobId, job?.status]);

  if (!job) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{job.sourceTitle ?? job.productName ?? "Procesando vídeo…"}</h1>
          <JobStatusBadge status={job.status} />
        </div>
        {job.sourceUrl && <p className="mt-1 text-sm text-slate-500">{job.sourceUrl}</p>}
        {job.statusMessage && job.status !== "DONE" && (
          <p className="mt-2 text-sm text-brand-400">{job.statusMessage}</p>
        )}
        {job.error && <p className="mt-2 text-sm text-red-400">Error: {job.error}</p>}
      </div>

      {job.clips.length > 0 && (
        <div className="space-y-4">
          {job.clips
            .slice()
            .sort((a, b) => b.viralityScore - a.viralityScore)
            .map((clip) => (
              <ClipCard key={clip.id} clip={clip} />
            ))}
        </div>
      )}
    </div>
  );
}
