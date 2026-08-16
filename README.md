# Escenas Virales Studio

Generador de shorts virales con IA para el canal **Escenas Virales**. Pega el enlace de
cualquier vídeo (YouTube u otro compatible con `yt-dlp`) y la app:

1. Descarga el vídeo y lo transcribe.
2. Usa IA (Claude u OpenAI) para encontrar los mejores momentos: los más divertidos,
   sorprendentes o con más gancho.
3. Le pone a cada short un **título estratégico corto**, una **descripción corta** adaptada
   al canal, una **probabilidad de viralidad (0-100%)** y **hashtags** pensados para maximizar
   alcance en ese momento.
4. Corta el clip en vertical 9:16 (fondo desenfocado + vídeo centrado, estilo short/reel).
5. Te deja publicarlo con un clic en **YouTube** y **TikTok** desde tus propias cuentas
   conectadas.

## Cómo funciona por dentro

- **Next.js 14** (App Router, TypeScript, Tailwind) — interfaz + API.
- **SQLite + Prisma** — guarda trabajos, clips, hashtags y tokens de las cuentas conectadas.
- **`yt-dlp`** — descarga el vídeo fuente.
- **`ffmpeg`** — recorta cada momento y lo recompone a formato vertical.
- **Whisper (OpenAI)** — transcribe el audio con marcas de tiempo.
- **Claude o GPT** — analiza la transcripción y decide los mejores momentos, títulos,
  descripciones, puntuación de viralidad y hashtags.
- Un **worker** aparte (`worker/index.ts`) procesa los vídeos en segundo plano, para no
  bloquear la web mientras se descarga/transcribe/corta (puede tardar varios minutos por vídeo).
- Hay un **login con contraseña** (`APP_PASSWORD`) porque esta app puede subir vídeos a tus
  cuentas: no la dejes accesible sin contraseña en internet.

## Puesta en marcha (Docker, recomendado)

```bash
cp .env.example .env
# edita .env y rellena como mínimo: APP_PASSWORD, SESSION_SECRET, ANTHROPIC_API_KEY u OPENAI_API_KEY,
# y OPENAI_API_KEY_WHISPER (o deja que use OPENAI_API_KEY si ya usas OpenAI para todo)

docker compose up --build -d
```

La app queda en `http://localhost:3000` (o el dominio que pongas en `APP_URL`). El servicio
`worker` procesa los vídeos en segundo plano; `web` sirve la interfaz.

## Puesta en marcha sin Docker (desarrollo)

Necesitas `ffmpeg` y `yt-dlp` instalados en el sistema.

```bash
npm install
cp .env.example .env    # y rellena las claves
npx prisma db push      # crea la base de datos SQLite

npm run dev              # servidor web (terminal 1)
npm run worker            # worker que procesa los vídeos (terminal 2)
```

## Claves y credenciales que necesitas

### IA (obligatorio para analizar el vídeo)

- **`AI_PROVIDER`**: `anthropic` o `openai`. Es quien elige los mejores momentos, escribe
  títulos/descripciones y puntúa la viralidad.
  - Anthropic: consigue tu clave en https://console.anthropic.com
  - OpenAI: consigue tu clave en https://platform.openai.com
- **`OPENAI_API_KEY_WHISPER`**: la transcripción del audio siempre usa la API Whisper de
  OpenAI, aunque uses Claude para el análisis. Si ya tienes `OPENAI_API_KEY`, puedes dejar
  este campo vacío y se reutiliza automáticamente.

### YouTube (para publicar automáticamente)

1. Crea un proyecto en [Google Cloud Console](https://console.cloud.google.com).
2. Activa la **YouTube Data API v3**.
3. En "Credenciales", crea un **OAuth 2.0 Client ID** de tipo "Aplicación web".
4. Añade como URI de redirección autorizado: `{APP_URL}/api/auth/youtube/callback`.
5. Copia el Client ID y el Client Secret a `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
6. Mientras tu app de Google esté en modo "Prueba" (Testing), añade tu propia cuenta de Google
   como "usuario de prueba" en la pantalla de consentimiento OAuth para poder autorizarla.
7. La cuota gratuita de la API (10.000 unidades/día) permite subir hasta ~6 vídeos al día;
   pide más cuota en la Google Cloud Console si necesitas subir más.

Desde **Ajustes** dentro de la app, pulsa "Conectar YouTube" y autoriza tu cuenta.

### TikTok (para publicar automáticamente)

1. Crea una app en [TikTok for Developers](https://developers.tiktok.com/apps).
2. Activa los productos **Login Kit** y **Content Posting API**.
3. Añade como URI de redirección: `{APP_URL}/api/auth/tiktok/callback`.
4. Copia el Client Key y el Client Secret a `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
5. **Importante**: hasta que TikTok audite y apruebe tu app para "Direct Post" (puede tardar
   varias semanas), el "Content Posting API" solo permite subir vídeos a tu propia bandeja de
   borradores (inbox), no publicarlos directamente en público. Esta app ya está montada así:
   cuando pulsas "Enviar a TikTok", el vídeo llega como borrador privado a tu cuenta y lo
   publicas tú con un toque desde la app de TikTok. En cuanto TikTok apruebe tu solicitud de
   auditoría, cambia la URL en `src/lib/social/tiktok.ts`
   (`INBOX_UPLOAD_INIT_URL` → el endpoint de publicación directa) para que se publique solo.

### Hashtags "en tendencia"

No existe ninguna API pública y gratuita de hashtags en tendencia en tiempo real para
TikTok/YouTube. La app pide a la IA que sugiera los mejores hashtags según las buenas
prácticas de cada plataforma y el nicho del canal, y lo hace **de nuevo justo antes de cada
publicación** (no solo al analizar el vídeo), para no subir con hashtags desactualizados.
Si más adelante contratas un proveedor de datos de tendencias (de pago), puedes conectarlo
sin tocar código: define `TRENDS_API_URL` (y opcionalmente `TRENDS_API_KEY`) apuntando a un
endpoint que devuelva `{"hashtags": ["..."]}`, y la app combinará esos datos con la sugerencia
de la IA (ver `src/lib/trends/hashtags.ts`).

## Aviso legal/derechos de autor

Esta app está pensada para el canal de recopilación **Escenas Virales**. Volver a subir
fragmentos del contenido de otros creadores puede infringir derechos de autor según la
plataforma, el país y el uso que se le dé, incluso citando la fuente. Antes de publicar en
masa, revisa las políticas de "contenido reutilizado" de YouTube y TikTok y valora añadir
comentario/transformación propia, dar crédito visible al creador original, o pedir permiso,
para reducir el riesgo de reclamaciones de copyright o "strikes" en tu canal.

## Estructura del proyecto

```
src/app/                 páginas (dashboard, detalle de job, ajustes, login) y rutas API
src/lib/pipeline/         descarga (yt-dlp), transcripción (Whisper), análisis (IA), corte (ffmpeg)
src/lib/social/           OAuth y subida a YouTube / TikTok
src/lib/trends/           sugerencia de hashtags
src/lib/ai/               proveedor de IA intercambiable (Anthropic / OpenAI)
worker/index.ts           proceso en segundo plano que ejecuta el pipeline
prisma/schema.prisma      modelo de datos (Job, Clip, Publication, SocialAccount)
```

## Configuración típica de vídeo/duración

En `.env` puedes ajustar cuántos shorts genera por vídeo (`MAX_CLIPS_PER_JOB`) y la duración
mínima/máxima de cada uno (`CLIP_MIN_SECONDS` / `CLIP_MAX_SECONDS`).
