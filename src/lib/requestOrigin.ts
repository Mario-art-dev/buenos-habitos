import type { NextRequest } from "next/server";

/**
 * La URL pública de esta app cambia cada vez que se reinicia la sesión (el túnel de Cloudflare
 * asigna un subdominio nuevo al azar), así que no se puede fiar de una variable de entorno fija
 * (APP_URL) para construir el redirect_uri de OAuth — siempre se quedaría apuntando a la URL de
 * cuando arrancó el servidor, o a "http://localhost:3000" si nunca se puso. En vez de eso, se
 * deriva de la propia petición entrante: el navegador ya está hablando con la URL real (el host
 * que puso al escribirla), así que la cabecera Host de la petición SIEMPRE es la correcta.
 */
export function getRequestOrigin(req: NextRequest): string {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
  const proto = req.headers.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}
