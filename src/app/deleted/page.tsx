import DeletedClient from "./DeletedClient";

export default function DeletedPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Eliminados</h1>
      <p className="mb-6 text-sm text-slate-400">
        Vídeos que has borrado con la X (listos, con error o en proceso). Sus archivos ya no ocupan espacio, esto es
        solo un registro de qué había y cuándo se borró.
      </p>
      <DeletedClient />
    </div>
  );
}
