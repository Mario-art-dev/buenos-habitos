import GalleryClient from "./GalleryClient";

export default function GalleryPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Galería</h1>
      <p className="mb-6 text-sm text-slate-400">Todos tus shorts listos: descárgalos en máxima calidad o publícalos.</p>
      <GalleryClient />
    </div>
  );
}
