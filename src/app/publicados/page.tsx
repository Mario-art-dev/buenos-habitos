import PublicadosClient from "./PublicadosClient";

export default function PublicadosPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Publicados</h1>
      <p className="mb-6 text-sm text-slate-400">
        Registro de qué shorts se han publicado, en qué plataforma y cuándo. Al publicarse en todas las plataformas
        conectadas, el vídeo se borra de la Galería para ahorrar espacio — esto es solo el historial.
      </p>
      <PublicadosClient />
    </div>
  );
}
