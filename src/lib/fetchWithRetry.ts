/**
 * El túnel gratuito (Cloudflare Quick Tunnel) a veces tarda en "despertar" la conexión en la
 * primera petición tras un rato inactivo, y eso hace que fetch() falle a bajo nivel ("Load
 * failed" en Safari/iOS). Reintentamos solos esos fallos de red y los 5xx (no los 4xx, que no
 * se arreglan reintentando) en vez de obligar al usuario a volver a darle al botón.
 */
export async function fetchWithRetry(input: string, init: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, init);
      if (!res.ok && res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}
