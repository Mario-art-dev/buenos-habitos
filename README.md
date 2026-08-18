# Escenas Virales Studio

Generador de shorts virales con IA para el canal **Escenas Virales**. Pega el enlace de
cualquier vídeo (YouTube u otro compatible con `yt-dlp`) y la app:

1. Descarga el vídeo y lo transcribe.
2. Usa IA (Claude u OpenAI) para encontrar los mejores momentos: los más divertidos,
   sorprendentes o con más gancho.
3. Le pone a cada short un **título estratégico corto**, una **descripción corta** adaptada
   al canal, una **probabilidad de viralidad (0-100%)** y **hashtags** pensados para maximizar
   alcance en ese momento.
4. Envuelve el clip con un **comentario/reacción narrado por IA** (voz en off + texto en
   pantalla) antes y después del momento, dando su propia opinión — para que el vídeo se
   transforme y no sea una copia directa (ver el aviso legal más abajo).
5. Corta el clip en vertical, a la mayor resolución que dé el vídeo fuente (hasta 4K), sin
   ninguna marca de agua.
6. Te deja publicarlo con un clic en **YouTube** y **TikTok** desde tus propias cuentas
   conectadas, o descargarlo directamente a tu galería.
7. Puede publicar solo, según la programación que definas (cada N horas, o en franjas
   horarias concretas como "lunes 12:00-14:00").

También tiene un **modo Rankings**: le pegas un vídeo largo de recopilación (p. ej. una hora
de fails variados) y la IA detecta los momentos, los agrupa por categoría (fails de coches,
de acrobacias, de animales…) y monta un vídeo de cuenta atrás por categoría, con el número de
puesto en pantalla y los subtítulos ya quemados — listo para descargar o publicar.

Y dos modos pensados para monetización con publicidad de terceros:

- **Modo Producto**: subes fotos/vídeos de un producto (o pegas su enlace) y la IA escribe un
  guion publicitario propio, lo narra con voz de IA y monta un short vertical con tu enlace de
  afiliado, para vídeos de recomendación de producto (TikTok Shop, Amazon Afiliados, etc.).
- **Modo Canción**: le pegas un vídeo de recopilación ya existente y el enlace de YouTube de una
  canción, y la app detecta el ritmo (beats) de la canción y vuelve a montar los mejores
  momentos con los cambios de plano sincronizados al compás — para vídeos tipo "hype edit".

## Cómo funciona por dentro

- **Next.js 14** (App Router, TypeScript, Tailwind) — interfaz + API.
- **SQLite + Prisma** — guarda trabajos, clips, hashtags y tokens de las cuentas conectadas.
- **`yt-dlp`** — descarga el vídeo fuente.
- **`ffmpeg`** — recorta cada momento y lo recompone a formato vertical.
- **Whisper** — transcribe el audio con marcas de tiempo, vía la API de OpenAI (de pago) o
  con `faster-whisper` en el propio servidor (gratis).
- **Groq, Gemini, Claude o GPT** — analiza la transcripción y decide los mejores momentos,
  títulos, descripciones, puntuación de viralidad y hashtags. Groq y Gemini tienen capa
  gratuita (Gemini no disponible en la UE/Reino Unido/Suiza).
- **Piper o la API de voz de OpenAI** — sintetiza el comentario/reacción narrado que envuelve
  cada vídeo, y el guion narrado de los vídeos de producto. Piper es gratis y corre en tu
  propio servidor.
- **`librosa`** (Python, gratis) — detecta el tempo y los golpes (beats) de la canción elegida
  en el modo Canción, para sincronizar los cortes de vídeo con el ritmo.
- Un **worker** aparte (`worker/index.ts`) procesa los vídeos en segundo plano, para no
  bloquear la web mientras se descarga/transcribe/corta (puede tardar varios minutos por vídeo).
  Ese mismo worker ejecuta el **planificador de publicación automática** cada minuto.
- Hay un **login con contraseña** (`APP_PASSWORD`) porque esta app puede subir vídeos a tus
  cuentas: no la dejes accesible sin contraseña en internet.

### Subtítulos quemados

`ENABLE_SUBTITLES="true"` (activado por defecto): cada short quema sobre el vídeo los subtítulos
de su propia transcripción — ayuda mucho a la retención (se entiende sin sonido, que es como se
ve la mayoría de los shorts) y refuerza el gancho inicial. Desactívalo con `ENABLE_SUBTITLES="false"`.
El tamaño es el de un subtítulo normal (no el "caption" gigante típico de TikTok), pegado abajo, en
blanco con un contorno negro fino. Van palabra por palabra (no por frase entera) cuando el motor de
transcripción da marcas de tiempo por palabra — tanto `faster-whisper` local como la API de Whisper
las dan; si algún proveedor no las diera, cae automáticamente a subtítulos por frase. **Cada palabra
cambia de color** (verde/blanco/amarillo/naranja, rotando) según se va leyendo, para que sea más
interactivo y llame la atención — a petición expresa del usuario.

### Caption grande y de colores en el centro

`ENABLE_BIG_CAPTIONS="true"` (activado por defecto): una SEGUNDA capa de subtítulo, aparte del de
abajo, con 2-4 palabras por golpe, algo por debajo del centro de la pantalla (el corte de cada
golpe sigue las pausas reales al hablar, no un conteo fijo, para que el ritmo se sienta natural),
cambiando de color (verde/blanco/amarillo/naranja) y con un contorno + desenfoque que da un efecto
de brillo — el estilo de canales tipo MrBeastClips. Se queman los dos subtítulos a la vez, con
TODAS las palabras que se dicen en el tramo (ninguna se salta). Necesita marcas de tiempo por
palabra (si el proveedor no las diera, esta capa simplemente no aparece, igual que la de abajo).
El subtítulo de abajo usa `fonts-liberation` (equivalente libre de Arial); el caption grande del
centro usa `fonts-comic-neue` (una tipografía redondeada, instaladas ambas junto a ffmpeg).
Desactívalo con `ENABLE_BIG_CAPTIONS="false"` si prefieres solo el subtítulo de abajo.

### Zoom dinámico ("punch-in")

`ENABLE_DYNAMIC_ZOOM="true"` (activado por defecto): la MAYORÍA del tiempo el short se ve recortado
en vertical, llenando toda la pantalla sin barras de fondo desenfocado; solo de vez en cuando (una
ráfaga de ~2s cada 12s, con un desfase distinto por clip para que no todos "abran" a la vez) se ve
el plano ancho original con las barras — para que la mayoría del short se sienta en vertical de
verdad y el plano ancho quede como un respiro ocasional, no al revés. Desactívalo con
`ENABLE_DYNAMIC_ZOOM="false"` si prefieres el encuadre ancho fijo de siempre.

### Gancho inicial con persona en pantalla

`ENABLE_HOOK_FRAME_CHECK="true"` (activado por defecto): antes de cortar cada short, se comprueba
con IA (un único fotograma, una única llamada — para no disparar el gasto de tokens en vídeos con
muchos clips) si al principio se ve a una persona en pantalla; si no, se adelanta un poco el inicio
como mejor intento. Cuesta un fotograma + llamada de más por clip (modelo de visión), así que en
vídeos con muchos clips resta presupuesto diario real de la capa gratuita de IA — si notas que se
te agota el cupo antes de tiempo, puedes desactivarlo con `ENABLE_HOOK_FRAME_CHECK="false"`.

### Comentario/reacción narrado con IA

Con `ENABLE_COMMENTARY="true"` (DESACTIVADO por defecto — un short profesional entra directo a
la acción, sin pantalla negra al principio), cada short y cada vídeo de ranking se envuelve con
comentario en off generado por IA:

- **Shorts individuales**: una frase de intro antes del clip (presentando el momento con
  gancho) y una frase de cierre después (con opinión/análisis), narradas con voz y mostradas
  también como texto en pantalla sobre fondo negro.
- **Rankings**: intro narrada para todo el vídeo, un comentario narrado en la tarjeta de cada
  puesto (`#5`, `#4`...) y un cierre narrado al final con la conclusión del ranking.

El guion generado se guarda y se muestra en la ficha de cada vídeo, para que veas exactamente
qué se ha dicho. La voz se sintetiza con `TTS_PROVIDER`: `local` (Piper, gratis, corre en tu
servidor) u `openai` (de pago, voz más natural). Actívalo con `ENABLE_COMMENTARY="true"` si
prefieres esa reacción en off (a cambio de una pantalla negra de unos segundos al principio/final).

⚠️ **Sobre "contenido original" — lo que esto soluciona y lo que NO soluciona.** Hay dos
sistemas distintos y separados:

1. **Que TikTok/YouTube consideren el vídeo "original"** para dejarte monetizar por
   visualizaciones (política de cada plataforma). Añadir tu propio comentario/reacción y
   transformar el vídeo **ayuda mucho** con esto — es el mismo enfoque que usan los canales de
   reacción/análisis que sí consiguen monetizar. Pero **no hay ninguna garantía**: la detección
   de "contenido no original" de TikTok es automática y no sigue una regla exacta que se pueda
   cumplir con matemática.
2. **Que el creador original del clip pueda reclamarte por derechos de autor.** Esto es un
   asunto legal, no de la plataforma, y **añadir comentario no lo elimina**. Aunque una
   plataforma apruebe tu monetización, el dueño de los derechos del vídeo original puede seguir
   pidiendo que se retire o presentar una reclamación — son dos sistemas independientes, y pasar
   el primero no te protege del segundo.

En resumen: esta función mejora tus opciones en ambos frentes, pero no las garantiza. Cuanto
más tuyo se vea el vídeo (tu voz, tu opinión, tu edición), mejor te va a ir, pero la
responsabilidad de qué contenido reutilizas y cómo lo presentas sigue siendo tuya.

### Idioma del contenido generado

`CHANNEL_LANGUAGE` controla el idioma de TODO el texto que escribe la IA: títulos,
descripciones, hashtags, categorías de ranking y el comentario en off (tanto el guion como la
voz de Piper, que se elige sola según este idioma). **Por defecto está en inglés** (`"en"`)
porque suele dar más ingresos publicitarios (CPM más alto) que el español; ponlo en `"es"` (o
cualquier otro código de idioma) en tu `.env` si prefieres otro idioma.

Esto **no afecta al audio original de los vídeos fuente**: nunca se traduce ni se dobla, se usa
tal cual venga. Si el vídeo que subes ya está en inglés, el diálogo del clip se queda en inglés
igual; `CHANNEL_LANGUAGE` solo decide en qué idioma escribe la IA el título, la descripción, los
hashtags y el comentario que TÚ añades por encima.

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

### Modo Producto (vídeos publicitarios con enlace de afiliado)

1. Le das el nombre del producto, opcionalmente su enlace (afiliado o tienda) y opcionalmente
   un anuncio existente como referencia de estructura (no se copia, solo inspira el ritmo).
2. Subes tus propias fotos/vídeos del producto. Si no subes nada pero das el enlace, la app
   intenta extraer fotos de esa página automáticamente (best-effort: busca las imágenes
   principales de la página, puede fallar según cómo esté construida la web).
3. La IA mira las fotos/fotogramas (visión) y escribe un guion propio: un gancho inicial, una
   frase por cada foto/clip contando qué se ve y por qué mola, y una llamada a la acción final
   mencionando el enlace.
4. Sintetiza el guion con voz de IA y monta cada foto en vídeo con efecto Ken Burns (zoom lento),
   o reformatea a vertical cada vídeo de producto que hayas subido, narrado encima.
5. El enlace de afiliado queda guardado en el clip y visible en su ficha, para que lo copies a
   la descripción/bio al publicar.

⚠️ **Sobre el avatar de IA**: por ahora este modo NO genera un personaje/presentador
ultra-realista con IA ni clona voces de terceros — eso requiere un servicio de pago aparte
(p. ej. D-ID, HeyGen o Synthesia) y, si imita a una persona real identificable, puede chocar con
el derecho a la propia imagen (España: Ley Orgánica 1/1982) y con el etiquetado obligatorio de
contenido sintético del Reglamento de IA de la UE. Si más adelante quieres añadir un avatar,
hace falta conectar una de esas plataformas.

### Modo Canción (montaje al ritmo de una canción)

1. Le pasas un vídeo de recopilación ya existente y el enlace de YouTube de la canción elegida.
2. Descarga el audio de la canción y detecta su tempo (BPM) y los tiempos exactos de cada golpe
   (beat) con `librosa`.
3. Analiza el vídeo fuente igual que el modo Rankings (segmentación por silencios + IA con
   visión) para elegir los mejores momentos.
4. Corta cada momento con la duración justa para que el cambio de plano caiga en el compás de la
   canción, concatena los cortes y sustituye el audio original del vídeo por la canción elegida.
5. La duración final se limita con `SONG_MAX_DURATION_SEC` (60s por defecto).

⚠️ Mismo aviso de derechos de autor que la música de fondo del modo Rankings: usar una canción
con copyright puede generar una reclamación de Content ID en la plataforma de destino.

## Modo 100% gratis (sin pagar nada de IA)

La app puede funcionar sin ningún coste de API. Pon esto en tu `.env`:

```bash
AI_PROVIDER="groq"                # Groq tiene capa gratuita, sin tarjeta
GROQ_API_KEY="tu-clave"           # gratis en https://console.groq.com/keys
TRANSCRIPTION_PROVIDER="local"    # transcribe en tu propio servidor, sin API
```

> ⚠️ **Si estás en la Unión Europea, Reino Unido o Suiza, usa Groq y no Gemini.** La capa
> gratuita de Gemini no está disponible ahí — Google exige activar facturación con tarjeta por
> las exigencias de manejo de datos del RGPD/Reglamento de IA europeo, aunque no llegues a
> gastar nada. Groq no tiene esa restricción ni pide tarjeta en ningún país. Si no estás en esa
> zona, `AI_PROVIDER="gemini"` con `GEMINI_API_KEY` funciona igual de bien.

- **Groq** (o Gemini fuera de la UE/Reino Unido/Suiza) analiza el vídeo, elige los mejores
  momentos y escribe títulos, descripciones, hashtags y la puntuación de viralidad. La capa
  gratuita tiene límites de peticiones por minuto y por día; para un uso normal (unos pocos
  vídeos al día) sobra. Si te pasas del límite, la app fallará ese trabajo con un error del
  proveedor y podrás reintentarlo más tarde.
- **Whisper local** (`faster-whisper`) transcribe el audio en el propio servidor: gratis, sin
  claves y sin límite de tamaño de archivo. A cambio es más lento y consume CPU —
  con `LOCAL_WHISPER_MODEL="base"` va bien; `small` transcribe mejor y tarda más.
- La voz del comentario narrado (`TTS_PROVIDER`) ya es `local` (Piper) **por defecto**: no hace
  falta tocar nada para que también sea gratis.

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

## Modo sin servidor: GitHub Actions (gratis, sin tarjeta, sin ordenador)

Si no puedes/quieres verificarte con una tarjeta en un proveedor cloud (Oracle, Google, AWS...),
hay una alternativa que no pide tarjeta en ningún momento: usar **GitHub Actions** como el
"ordenador" que genera el vídeo, en vez de tener un servidor encendido 24/7. La contrapartida:
no hay web con panel ni publicación automática — pides un vídeo desde un formulario, esperas
unos minutos y te descargas el resultado.

### Configurarlo (una sola vez)

1. En **Settings → General** del repositorio, comprueba que es **público** (así los minutos de
   GitHub Actions son gratis e ilimitados; en repos privados el plan gratis da 2000 min/mes,
   que también suele sobrar, pero público es lo más simple para no preocuparse).
2. Consigue una clave gratis de Groq en <https://console.groq.com/keys> (no pide tarjeta, sin
   restricción por país). Si no estás en la UE/Reino Unido/Suiza también vale Gemini en
   <https://aistudio.google.com/apikey>.
3. En **Settings → Secrets and variables → Actions → New repository secret**, crea un secreto
   llamado `GROQ_API_KEY` (o `GEMINI_API_KEY` si usas Gemini) con esa clave.

### Generar un vídeo

1. Ve a la pestaña **Actions** del repositorio → workflow **"Generar short"** → botón
   **Run workflow**.
2. Elige el modo (`SINGLE`, `RANKING`, `PRODUCT` o `SONG`) y rellena los campos que le
   correspondan:
   - `SINGLE`/`RANKING`: `sourceUrl` (el enlace del vídeo).
   - `SONG`: `sourceUrl` (la recopilación) + `songUrl` (la canción).
   - `PRODUCT`: `productName` y, o bien `productLink` (para que la IA saque fotos de esa
     página), o bien `productImageUrls` con una URL de foto/vídeo por línea (no se pueden
     subir archivos directamente desde el formulario de GitHub, así que las fotos tienen que
     estar ya alojadas en algún sitio con enlace directo).
3. Pulsa **Run workflow** y espera — tarda entre 5 y 20 minutos según el vídeo.
4. Cuando termine (círculo verde ✓), entra en esa ejecución y descarga el archivo que aparece
   en **Artifacts**: dentro hay el vídeo (`.mp4`), la miniatura (`.jpg`) y un `.txt` por cada
   clip con el título, la descripción, los hashtags y la puntuación de viralidad que ha
   generado la IA, listos para copiar al subir el vídeo a mano en TikTok/YouTube.

Todo esto se puede hacer desde el navegador del móvil sin instalar nada.

## Modo panel completo sin servidor propio: "Servidor temporal" en GitHub Actions

Si además del modo anterior quieres el panel web de verdad (galería, botones, generar desde un
formulario cómodo) sin pagar ni verificarte con tarjeta en ningún sitio, hay un segundo workflow
que enciende la web y el worker **dentro de una Action** y la publica en una URL pública temporal
con un túnel de Cloudflare (no necesita cuenta ni dominio).

Cada sesión dura como máximo **6 horas** (límite fijo de GitHub, no configurable) — pero antes de
que se acabe, la propia Action lanza automáticamente la siguiente sesión, así que en la práctica
el panel se queda disponible de forma casi continua, encadenando sesiones solo.

### Configurarlo (una sola vez)

Además de `GROQ_API_KEY` (o `GEMINI_API_KEY`, ver arriba), crea estos dos secretos en
**Settings → Secrets and variables → Actions → Secrets**:

- `APP_PASSWORD` → la contraseña con la que entrarás al panel.
- `SESSION_SECRET` → cualquier cadena larga aleatoria.

### Encenderlo

1. Pestaña **Actions** → workflow **"Servidor temporal"** → **Run workflow**.
2. Espera 1-2 minutos a que compile. Al final de esa ejecución, en el resumen de la página
   (arriba del todo, no hace falta bajar por los logs) aparece la URL pública, algo como
   `https://palabras-random.trycloudflare.com`.
3. Abre esa URL, entra con tu `APP_PASSWORD` y ya tienes el panel completo: generar shorts,
   ver la galería, descargar vídeos... igual que en la web normal.

### Cuando rote la URL

Unos 15 minutos antes de cumplirse las 6 horas, esa sesión lanza sola la siguiente y termina.
Vuelve a la pestaña **Actions**, entra en la ejecución más reciente de "Servidor temporal" y
coge la URL nueva del resumen. La galería de vídeos se mantiene entre sesiones (se guarda en la
caché de GitHub), así que no pierdes el historial al rotar — solo cambia el enlace.

### Apagarlo

Ve a **Settings → Secrets and variables → Actions → Variables → New repository variable**, crea
una llamada `SERVER_ENABLED` con el valor `false`. La sesión en curso se apaga en su siguiente
ciclo y no se vuelve a relanzar sola. Para volver a encenderlo: borra esa variable (o ponla en
`true`) y lanza el workflow otra vez a mano.

> Nota: como la URL cambia en cada rotación, conectar YouTube/TikTok con OAuth para publicar
> con un clic no es práctico en este modo — sigues subiendo cada vídeo a mano desde el panel,
> copiando el título/descripción/hashtags que te genera la IA.

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
  la viralidad. Cuatro opciones:

  | Valor | Coste | Clave |
  |---|---|---|
  | `groq` | **Gratis** (capa gratuita con límites), sin restricción por país | https://console.groq.com/keys |
  | `gemini` | **Gratis** (capa gratuita con límites) — **NO disponible en la UE/Reino Unido/Suiza** | https://aistudio.google.com/apikey |
  | `anthropic` | De pago por uso | https://console.anthropic.com |
  | `openai` | De pago por uso | https://platform.openai.com |

- **`TRANSCRIPTION_PROVIDER`**: cómo se transcribe el audio.
  - `local` → **gratis**, con `faster-whisper` en tu propio servidor. No necesita ninguna clave.
  - `openai` → API de Whisper, de pago pero más rápida. Usa `OPENAI_API_KEY_WHISPER` (o
    reutiliza `OPENAI_API_KEY` si ya la tienes puesta).

  Los dos ajustes son independientes: puedes usar Claude para el análisis y Whisper local
  para transcribir, o Groq/Gemini gratis para todo.

### YouTube (para publicar automáticamente)

1. Crea un proyecto en [Google Cloud Console](https://console.cloud.google.com).
2. Activa la **YouTube Data API v3**.
3. En "Credenciales", crea un **OAuth 2.0 Client ID** de tipo "Aplicación web".
4. Añade como URI de redirección autorizado: `{TU_URL_ACTUAL}/api/auth/youtube/callback`
   (ver el aviso de "Servidor temporal" justo abajo — **importante** si usas el modo sin servidor propio).
5. Copia el Client ID y el Client Secret a `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
6. Mientras tu app de Google esté en modo "Prueba" (Testing), añade tu propia cuenta de Google
   como "usuario de prueba" en la pantalla de consentimiento OAuth para poder autorizarla.
7. La cuota gratuita de la API (10.000 unidades/día) permite subir hasta ~6 vídeos al día;
   pide más cuota en la Google Cloud Console si necesitas subir más.

Desde **Ajustes** dentro de la app, pulsa "Conectar YouTube" y autoriza tu cuenta.

### TikTok (para publicar automáticamente)

1. Crea una app en [TikTok for Developers](https://developers.tiktok.com/apps).
2. Activa los productos **Login Kit** y **Content Posting API**.
3. Añade como URI de redirección: `{TU_URL_ACTUAL}/api/auth/tiktok/callback`
   (ver el aviso de "Servidor temporal" justo abajo — **importante** si usas el modo sin servidor propio).
4. Copia el Client Key y el Client Secret a `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
5. **Importante**: hasta que TikTok audite y apruebe tu app para "Direct Post" (puede tardar
   varias semanas), el "Content Posting API" solo permite subir vídeos a tu propia bandeja de
   borradores (inbox), no publicarlos directamente en público. Esta app ya está montada así:
   cuando pulsas "Enviar a TikTok", el vídeo llega como borrador privado a tu cuenta y lo
   publicas tú con un toque desde la app de TikTok. En cuanto TikTok apruebe tu solicitud de
   auditoría, cambia la URL en `src/lib/social/tiktok.ts`
   (`INBOX_UPLOAD_INIT_URL` → el endpoint de publicación directa) para que se publique solo.

⚠️ **Si usas el modo "Servidor temporal" (sin servidor propio, ver más abajo): la URL de tu
web cambia cada vez que se reinicia la sesión** (túnel de Cloudflare, subdominio nuevo al
azar). La app ya calcula el redirect_uri correcto solo, a partir de la URL con la que entras
— pero Google y TikTok exigen que esa URL esté registrada EXACTA de antemano en su panel (no
admiten comodines, es una norma de seguridad suya, no algo que se pueda evitar con código).
Así que **cada vez que quieras conectar o reconectar una cuenta después de un reinicio**:

1. Copia tu URL actual (la del túnel, tipo `https://algo.trycloudflare.com`).
2. Ve a Google Cloud Console (Credenciales → tu Client ID → URIs de redirección autorizados) o
   al panel de TikTok for Developers (Login Kit → Redirect URI) desde el navegador del móvil.
3. Añade `{esa URL}/api/auth/youtube/callback` (o `/api/auth/tiktok/callback`) a la lista —
   puedes tener varias guardadas a la vez, no hace falta borrar las anteriores.
4. Ya puedes darle a "Conectar" en Ajustes.

Una vez conectada una cuenta, **no hace falta repetir esto para publicar** — solo para
conectar o reconectar por primera vez tras un reinicio (los tokens ya guardados siguen
funcionando solos). Si algún día quieres evitarte este paso manual del todo, la solución real
es un túnel con nombre fijo de Cloudflare, que requiere tener un dominio propio (de pago).

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
                          guion de comentario narrado, detección de silencios, montaje y música
                          de los vídeos de ranking
src/lib/social/           OAuth, subida a YouTube / TikTok y publicación compartida (publish.ts)
src/lib/trends/           sugerencia de hashtags
src/lib/schedule/         ajustes y motor del planificador de publicación automática
src/lib/ai/               proveedor de IA intercambiable (Groq / Gemini / Anthropic / OpenAI), con visión
src/lib/tts/              proveedor de voz intercambiable (Piper local gratis / OpenAI)
scripts/local_whisper.py  transcripción gratuita en el propio servidor (faster-whisper)
scripts/local_tts.py      voz narrada gratuita en el propio servidor (Piper)
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
