import SongForm from "@/components/SongForm";
import JobList from "@/components/JobList";

export default function SongPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Montaje al ritmo de una canción</h1>
        <p className="mt-1 text-sm text-slate-400">
          Pega un vídeo de recopilación ya existente y el enlace de YouTube de una canción, y la IA vuelve a montar
          los mejores momentos con los cambios de plano sincronizados al ritmo (beats) de esa canción.
        </p>
      </div>
      <SongForm />
      <JobList mode="SONG" emptyMessage="Todavía no has generado ningún montaje musical. Rellena el formulario de arriba para empezar." />
    </div>
  );
}
