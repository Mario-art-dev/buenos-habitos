import UrlForm from "@/components/UrlForm";
import JobList from "@/components/JobList";

export default function RankingsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Rankings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Pega un vídeo largo de recopilación (ej. una hora de fails variados) y la IA detecta los momentos,
          los agrupa por categoría (fails de coches, de acrobacias, de animales…) y monta un vídeo de cuenta
          atrás por cada categoría con al menos {""}
          <span className="text-slate-300">5 momentos</span>, con el número de puesto y los subtítulos ya
          incrustados, listo para descargar o publicar.
        </p>
      </div>
      <UrlForm
        mode="RANKING"
        label="Pega el enlace del vídeo largo de recopilación"
        buttonLabel="Generar rankings"
        helpText="Cuanto más largo y variado sea el vídeo, más categorías de ranking podrá detectar. El proceso tarda más que un short normal porque analiza fotogramas de muchos momentos."
      />
      <JobList mode="RANKING" emptyMessage="Todavía no has generado ningún ranking. Pega un vídeo largo arriba para empezar." />
    </div>
  );
}
