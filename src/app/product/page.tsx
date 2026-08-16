import ProductForm from "@/components/ProductForm";
import JobList from "@/components/JobList";

export default function ProductPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Vídeos de producto</h1>
        <p className="mt-1 text-sm text-slate-400">
          Sube fotos o vídeos del producto (o pega su enlace) y la IA escribe un guion publicitario propio, lo narra
          con voz de IA y monta un short vertical con tu enlace de afiliado en la descripción.
        </p>
      </div>
      <ProductForm />
      <JobList mode="PRODUCT" emptyMessage="Todavía no has generado ningún vídeo de producto. Rellena el formulario de arriba para empezar." />
    </div>
  );
}
