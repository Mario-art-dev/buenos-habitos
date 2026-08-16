# Escenas Virales Studio

Generador de shorts virales con IA para el canal **Escenas Virales**. Pega el enlace de
cualquier vídeo (YouTube u otro compatible con `yt-dlp`) y la app:

1. Descarga el vídeo y lo transcribe.
2. Usa IA (Claude u OpenAI) para encontrar los mejores momentos: los más divertidos,
   sorprendentes o con más gancho.
3. Le pone a cada short un **título estratégico corto**, una **descripción corta** adaptada
   al canal, una **probabilidad de viralidad (0-100%)** y **hashtags** pensados para maximizar
   alcance en ese momento.
4. Corta el clip en vertical, a la mayor resolución que dé el vídeo fuente (hasta 4K), sin
   ninguna marca de agua.
5. Te deja publicarlo con un clic en **YouTube** y **TikTok** desde tus propias cuentas
   conectadas, o descargarlo directamente a tu galería.
6. Puede publicar solo, según la programación que definas (cada N horas, o en franjas
   horarias concretas como "lunes 12:00-14:00").

También tiene un **modo Rankings**: le pegas un vídeo largo de recopilación (p. ej. una hora
de fails variados) y la IA detecta los momentos, los agrupa por categoría (fails de coches,
de acrobacias, de animales…) y monta un vídeo de cuenta atrás por categoría, con el número de
puesto en pantalla y los subtítulos ya quemados — listo para descargar o publicar.

## Cómo funciona por dentro

- **Next.js 14** (App Router, TypeScript, Tailwind) — interfaz + API.
- **SQLite + Prisma** — guarda trabajos, clips, hashtags y tokens de las cuentas conectadas.
- **`yt-dlp`** — descarga el vídeo fuente.
- **`ffmpeg`** — recorta cada momento y lo recompone a formato vertical.
- **Whisper** — transcribe el audio con marcas de tiempo, vía la API de OpenAI (de pago) o
  con `faster-whisper` en el propio servidor (gratis).
- **Gemini, Claude o GPT** — analiza la transcripción y decide los mejores momentos, títulos,
  descripciones, puntuación de viralidad y hashtags. Gemini tiene capa gratuita.
- Un **worker** aparte (`worker/index.ts`) procesa los vídeos en segundo plano, para no
  bloquear la web mientras se descarga/transcribe/corta (puede tardar varios minutos por vídeo).
  Ese mismo worker ejecuta el **planificador de publicación automática** cada minuto.
- Hay un **login con contraseña** (`APP_PASSWORD`) porque esta app puede subir vídeos a tus
  cuentas: no la dejes accesible sin contraseña en internet.

### Modo Rankings (vídeos de cuenta atrás tipo "TOP 5...")

1. Detecta posibles momentos independientes por cortes de silencio en el audio (típico de
   compilaciones editadas).
2. Extrae un fotograma de cada momento candidato y se lo enseña a la IA (Claude/GPT con
   visión) junto con la transcripción de ese tramo, para que decida si es un momento válido,
   en qué categoría encaja (fails de coches, de acrobacias, de animales...) y qué puntuación
   de impacto/gracia tiene.
3. Agrupa los momentos por categoría; cada categoría con al menos `RANKING_MIN_ITEMS`
   (por defecto 5) momentos se convierte en un vídeo de cuenta atrás propio (del puesto más
   bajo al puesto 1), con una tarjeta de número por puesto y los subtítulos del audio original
   quemados en el vídeo.
4. La IA sugiere además el **título de una canción concreta** que pegaría como música de
   fondo (`musicQuery`). En el detalle del vídeo puedes pegar el enlace de YouTube de esa
   canción (o de cualquier otra) y el segundo en el que empieza el fragmento que quieres: la
   app lo extrae con `yt-dlp` y remezcla el vídeo con esa música de fondo.
   ⚠️ **Aviso de derechos de autor**: usar una canción con copyright como música de fondo casi
   siempre genera una reclamación de Content ID (o similar) en la plataforma de destino,
   aunque el resto del vídeo sea tuyo. La app lo permite porque tú decides qué canción usar,
   pero la responsabilidad de esa elección es tuya. Si prefieres evitar el riesgo, no añadas
   música: el vídeo queda listo igualmente con el audio original de cada clip.

## Modo 100% gratis (sin pagar nada de IA)

La app puede funcionar sin ningún coste de API. Pon esto en tu `.env`:

```bash
AI_PROVIDER="gemini"              # Google Gemini tiene capa gratuita
GEMINI_API_KEY="tu-clave"         # gratis en https://aistudio.google.com/apikey
TRANSCRIPTION_PROVIDER="local"    # transcribe en tu propio servidor, sin API
```

- **Gemini** analiza el vídeo, elige los mejores momentos y escribe títulos, descripciones,
  hashtags y la puntuación de viralidad. Su capa gratuita tiene límites de peticiones por
  minuto y por día; para un uso normal (unos pocos vídeos al día) sobra. Si te pasas del
  límite, la app fallará ese trabajo con un error de Gemini y podrás reintentarlo más tarde.
- **Whisper local** (`faster-whisper`) transcribe el audio en el propio servidor: gratis, sin
  claves y sin límite de tamaño de archivo. A cambio es más lento y consume CPU —
  con `LOCAL_WHISPER_MODEL="base"` va bien; `small` transcribe mejor y tarda más.

**Dónde alojarlo gratis:** esta app necesita un servidor de verdad con disco persistente
(descarga vídeos, los corta con ffmpeg y guarda los shorts). Los planes gratuitos tipo
Vercel o Render **no sirven**: no conservan los archivos entre reinicios y tienen muy poca
memoria para procesar vídeo. La opción realmente gratuita es una máquina del plan
**"Always Free" de Oracle Cloud** (4 núcleos ARM, 24 GB de RAM, 200 GB de disco, gratis de
forma permanente), que aguanta ffmpeg y Whisper local sin problema. También vale cualquier
ordenador propio que puedas dejar encendido.

> Nota: el modo gratis solo cubre la IA y el alojamiento. Conectar YouTube y TikTok sigue
> necesitando que crees tus propias credenciales OAuth (que también son gratuitas, pero
> requieren darte de alta como desarrollador en cada plataforma — ver más abajo).

## Puesta en marcha (Docker, recomendado)

```bash
cp .env.example .env
# edita .env y rellena como mínimo: APP_PASSWORD, SESSION_SECRET y las claves de IA
# (o activa el modo gratis descrito arriba)

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

- **`AI_PROVIDER`**: quién elige los mejores momentos, escribe títulos/descripciones y puntúa
  la viralidad. Tres opciones:

  | Valor | Coste | Clave |
  |---|---|---|
  | `gemini` | **Gratis** (capa gratuita con límites) | https://aistudio.google.com/apikey |
  | `anthropic` | De pago por uso | https://console.anthropic.com |
  | `openai` | De pago por uso | https://platform.openai.com |

- **`TRANSCRIPTION_PROVIDER`**: cómo se transcribe el audio.
  - `local` → **gratis**, con `faster-whisper` en tu propio servidor. No necesita ninguna clave.
  - `openai` → API de Whisper, de pago pero más rápida. Usa `OPENAI_API_KEY_WHISPER` (o
    reutiliza `OPENAI_API_KEY` si ya la tienes puesta).

  Los dos ajustes son independientes: puedes usar Claude para el análisis y Whisper local
  para transcribir, o Gemini gratis para todo.

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

## Programación automática

Desde **Ajustes → Programación automática** puedes activar dos modos (sección
"Programación automática" en `src/components/ScheduleSettings.tsx`):

- **Intervalo fijo**: cada N horas, coge el short pendiente (sin publicar todavía) con mayor
  probabilidad de viralidad y lo sube a todas las plataformas seleccionadas y conectadas.
- **Franjas horarias**: defines franjas por día de la semana (ej. lunes 12:00-14:00). Al
  entrar en una franja, coge todos los shorts pendientes y los reparte dentro del tiempo que
  quede de franja (mínimo 5 minutos entre subidas) para no parecer spam, en vez de subirlos
  todos de golpe.

Un short cuenta como "pendiente" hasta la primera vez que se publica en cualquier plataforma
—ya sea manualmente desde su ficha o por el planificador— (campo `Clip.autoPublishedAt`), para
que la cola automática nunca vuelva a publicar algo que ya subiste tú a mano. Las horas de las
franjas se interpretan en la zona horaria del contenedor (variable `TZ` en `.env`, por defecto
la que traiga la imagen si no la defines).

## Aviso legal/derechos de autor

Esta app está pensada para el canal de recopilación **Escenas Virales**. Volver a subir
fragmentos del contenido de otros creadores puede infringir derechos de autor según la
plataforma, el país y el uso que se le dé, incluso citando la fuente. Antes de publicar en
masa, revisa las políticas de "contenido reutilizado" de YouTube y TikTok y valora añadir
comentario/transformación propia, dar crédito visible al creador original, o pedir permiso,
para reducir el riesgo de reclamaciones de copyright o "strikes" en tu canal.

## Estructura del proyecto

```
src/app/                 páginas (dashboard, rankings, galería, detalle de job, ajustes, login) y rutas API
src/lib/pipeline/         descarga (yt-dlp), transcripción (Whisper), análisis (IA), corte (ffmpeg),
                          detección de silencios, montaje y música de los vídeos de ranking
src/lib/social/           OAuth, subida a YouTube / TikTok y publicación compartida (publish.ts)
src/lib/trends/           sugerencia de hashtags
src/lib/schedule/         ajustes y motor del planificador de publicación automática
src/lib/ai/               proveedor de IA intercambiable (Gemini / Anthropic / OpenAI), con visión
scripts/local_whisper.py  transcripción gratuita en el propio servidor (faster-whisper)
worker/index.ts           proceso en segundo plano: pipeline de vídeos + planificador
prisma/schema.prisma      modelo de datos (Job, Clip, RankingItem, Publication, SocialAccount,
                          AutoPublishSettings, ScheduleWindow, AutoPublishTask)
```

## Descarga y galería

Cada short listo tiene un botón "Descargar" (sin marca de agua, con el archivo `.mp4`
original que se generó, a la resolución elegida según el vídeo fuente). En **Galería**
(`/gallery`) puedes ver y descargar todos los shorts de todos tus vídeos en un único sitio.

## Configuración típica de vídeo/duración

En `.env` puedes ajustar cuántos shorts genera por vídeo (`MAX_CLIPS_PER_JOB`) y la duración
mínima/máxima de cada uno (`CLIP_MIN_SECONDS` / `CLIP_MAX_SECONDS`).
