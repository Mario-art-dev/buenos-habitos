import clsx from "clsx";

export default function ViralityBadge({ score }: { score: number }) {
  const tier =
    score >= 80 ? "alto" : score >= 55 ? "medio" : "bajo";

  const styles = {
    alto: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    medio: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    bajo: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  } as const;

  return (
    <div
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        styles[tier]
      )}
      title="Probabilidad estimada por IA de que este short se vuelva viral"
    >
      🔥 {score}% viral
    </div>
  );
}
