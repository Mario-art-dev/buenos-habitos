"use client";

import { useEffect, useState } from "react";
import ClipCard, { ClipData } from "@/components/ClipCard";

export default function GalleryClient() {
  const [clips, setClips] = useState<ClipData[] | null>(null);

  useEffect(() => {
    fetch("/api/clips")
      .then((res) => res.json())
      .then((data) => setClips(data.clips));
  }, []);

  if (!clips) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (clips.length === 0) {
    return <p className="mt-10 text-center text-sm text-slate-500">Todavía no tienes ningún short listo.</p>;
  }

  return (
    <div className="space-y-4">
      {clips.map((clip) => (
        <ClipCard key={clip.id} clip={clip} />
      ))}
    </div>
  );
}
