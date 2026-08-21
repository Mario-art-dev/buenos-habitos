export const metadata = { title: "Términos del servicio" };

export default function TermsPage() {
  return (
    <div className="prose prose-invert max-w-none">
      <h1 className="mb-6 text-xl font-bold text-slate-50">Términos del servicio</h1>
      <div className="space-y-4 text-sm text-slate-300">
        <p>
          Escenas Virales Studio es una herramienta personal para generar y publicar vídeos cortos
          a partir de vídeos más largos, usando inteligencia artificial para elegir los mejores
          momentos. La usa un único creador de contenido para gestionar sus propias publicaciones
          en YouTube y TikTok.
        </p>
        <p>
          El servicio se ofrece "tal cual", sin garantías, y puede dejar de estar disponible en
          cualquier momento sin previo aviso. No se ofrece a terceros ni se comercializa.
        </p>
        <p>
          El usuario es responsable de tener los derechos necesarios sobre el contenido que sube o
          procesa, y de cumplir las normas de las plataformas (YouTube, TikTok) donde publica.
        </p>
        <p>
          Para cualquier duda sobre estos términos, contacta con el desarrollador a través de las
          cuentas conectadas en la propia aplicación.
        </p>
      </div>
    </div>
  );
}
