import DoubleForm from "@/components/DoubleForm";
import JobList from "@/components/JobList";

export default function DoublePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Modo doble (pantalla dividida)</h1>
        <p className="mt-1 text-sm text-slate-400">
          Pega un vídeo de arriba (el contenido) y un vídeo de abajo fijo (p.ej. gameplay de coche), elige en
          cuántas partes cortar el de arriba, y se genera un short por parte con los dos vídeos en pantalla
          dividida y el número de parte fijo arriba.
        </p>
      </div>
      <DoubleForm />
      <JobList mode="DOUBLE" emptyMessage="Todavía no has generado ningún vídeo en pantalla dividida. Rellena el formulario de arriba para empezar." />
    </div>
  );
}
