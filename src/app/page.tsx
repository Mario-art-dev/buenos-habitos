import UrlForm from "@/components/UrlForm";
import JobList from "@/components/JobList";
import { config } from "@/lib/config";

export default function HomePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Generador de Shorts Virales</h1>
        <p className="mt-1 text-sm text-slate-400">
          Para {config.channel.name} — pega cualquier vídeo y la IA hace el resto: mejores momentos,
          probabilidad de viralidad, títulos, descripciones, hashtags y publicación en YouTube y TikTok.
        </p>
      </div>
      <UrlForm />
      <JobList />
    </div>
  );
}
