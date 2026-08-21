export const metadata = { title: "Política de privacidad" };

export default function PrivacyPage() {
  return (
    <div className="prose prose-invert max-w-none">
      <h1 className="mb-6 text-xl font-bold text-slate-50">Política de privacidad</h1>
      <div className="space-y-4 text-sm text-slate-300">
        <p>
          Escenas Virales Studio es una herramienta de uso personal, operada por un único creador
          de contenido para gestionar sus propios vídeos. No recoge datos de terceros ni tiene
          usuarios públicos registrados.
        </p>
        <p>
          Los vídeos que se procesan, junto con los títulos, descripciones y hashtags generados,
          se guardan únicamente en el almacenamiento privado de la propia aplicación, para
          publicarlos en las cuentas de YouTube y TikTok que el operador conecta voluntariamente
          desde Ajustes.
        </p>
        <p>
          Al conectar una cuenta de YouTube o TikTok, la aplicación guarda el token de acceso
          necesario para publicar vídeos en nombre de esa cuenta. Ese token solo se usa para subir
          los vídeos generados; no se comparte con nadie más.
        </p>
        <p>
          No se venden ni comparten datos con terceros. Puedes desconectar cualquier cuenta en
          cualquier momento desde Ajustes, lo que borra el token guardado.
        </p>
        <p>
          Para cualquier duda sobre esta política, contacta con el desarrollador a través de las
          cuentas conectadas en la propia aplicación.
        </p>
      </div>
    </div>
  );
}
