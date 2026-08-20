import UrlForm from "@/components/UrlForm";
import JobList from "@/components/JobList";

export default function SplitPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Cortar en shorts</h1>
        <p className="mt-1 text-sm text-slate-400">
          Pega un vídeo y se corta entero, de principio a fin, en shorts consecutivos de la duración que
          elijas — sin que la IA decida qué usar (para eso está el modo{" "}
          <span className="text-slate-300">Clip viral</span>). Ideal para repartir una charla, un directo o
          un vídeo largo en varias partes seguidas.
        </p>
      </div>
      <UrlForm
        mode="SPLIT"
        label="Pega el enlace del vídeo a cortar"
        buttonLabel="Cortar en shorts"
        helpText="Se transcribe el vídeo y cada trozo recibe título, descripción y hashtags propios, listo para descargar o publicar."
      />
      <JobList mode="SPLIT" emptyMessage="Todavía no has cortado ningún vídeo. Pega un enlace arriba para empezar." />
    </div>
  );
}
