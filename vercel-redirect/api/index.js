// Redirector permanente: esta función vive en Vercel (gratis, siempre disponible) y
// simplemente reenvía cualquier visita a la URL del túnel de Cloudflare que esté activa
// en ese momento (GitHub Actions la actualiza aquí cada vez que arranca una sesión nueva).
// Así el enlace de Vercel nunca cambia, aunque el servidor real (efímero) sí lo haga.
module.exports = (req, res) => {
  const target = process.env.TUNNEL_URL;

  if (!target) {
    res.statusCode = 503;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      "<html><body style='font-family:sans-serif;text-align:center;padding:4rem'>" +
        "<h1>Servidor no disponible</h1>" +
        "<p>Todavía no hay ninguna sesión activa. Espera a que arranque el servidor y recarga esta página.</p>" +
        "</body></html>"
    );
    return;
  }

  const destination = target.replace(/\/$/, "") + (req.url || "/");
  res.statusCode = 302;
  res.setHeader("Location", destination);
  res.setHeader("Cache-Control", "no-store");
  res.end();
};
