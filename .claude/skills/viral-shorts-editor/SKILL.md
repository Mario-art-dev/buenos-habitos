---
name: viral-shorts-editor
description: Editorial and technical standards for Escenas Virales Studio's short-form video pipeline in this repo — clip selection, burned captions, the post-render text/caption editor, dynamic zoom/camera pacing, brand sting/cover card, and hashtag strategy. Use this skill whenever working on src/lib/pipeline/analyze.ts, clip.ts, bigCaptions.ts, coverCard.ts, regenerateClip.ts, transcribe.ts, src/app/clips/[id]/edit/**, or src/lib/trends/hashtags.ts, or whenever asked to make shorts more professional/entertaining, fix clip selection quality, adjust subtitle/caption style, add camera movement/zoom effects, change the brand sound/intro-outro cover, add fonts, or improve hashtags for this channel — even if the user describes it in plain terms ("que los clips sean mejores", "que los subtítulos se vean bien", "que sea más viral", "el sonido de marca", "las portadas", "el editor de texto") instead of naming these files directly. Also consult it before changing feature-flag defaults in src/lib/config.ts or the GitHub Actions workflows/Dockerfiles, since this project has a recurring bug pattern of those silently overriding or missing config defaults, and before touching anything that gets concatenated with concatClips (-c copy), since mismatched fps/audio params between segments is another recurring bug class here.
---

# Editor de shorts virales — Escenas Virales Studio

Este skill recoge el criterio editorial y las restricciones técnicas que este proyecto (un
generador de shorts virales que corre enteramente gratis en GitHub Actions) ha ido fijando a base
de pruebas reales del usuario. No lo trates como una lista de casillas a marcar: es el resultado
de iteración real, y la razón de cada punto importa tanto como el punto en sí — a la hora de tocar
código nuevo, razona desde el "por qué" en vez de copiar la regla a ciegas.

## Cómo pensar la selección de clips (`src/lib/pipeline/analyze.ts`)

Piensa como un editor de shorts con 20 años de experiencia en canales grandes (nivel MrBeast), no
como un algoritmo que reparte el vídeo en trozos iguales. La pregunta que importa por cada
candidato a clip es: **¿esto va a divertir/entretener de verdad a quien lo vea entero, o solo lo
estoy metiendo para llegar al número pedido?** Si la respuesta no es un sí claro, ese candidato no
vale, aunque eso signifique proponer menos clips de los que se pidieron — calidad antes que
cantidad, siempre.

Otros criterios que ya están en el prompt de `analyze.ts` y que hay que mantener si se toca:
- Gancho fuerte en los primeros 2 segundos; el objetivo es retener al espectador más allá del
  segundo 5, que es cuando TikTok/YouTube empiezan a contar la visualización de verdad.
- Solo pasar a un momento distinto cuando el vídeo cambie de verdad de tema/situación/gracia — no
  trocear mecánicamente un mismo momento en varios clips ni forzar un corte a media frase solo por
  llegar al número pedido.
- Títulos y descripciones escritos como los escribiría una persona real enganchada al vídeo
  (gancho, intriga, humor, tensión), nunca un resumen robótico ni relleno genérico.
- El arranque (`startSec`) tiene que sentirse tan profesional e impactante como el de un canal
  grande: entra ya en la acción o en la frase con más gancho, nunca en una respiración, silencio,
  transición o frase a medias.
- `src/lib/pipeline/hookFrame.ts` (`pickHookStartSec`, usado en modo SINGLE) comprueba con un único
  fotograma + una única llamada de visión si al principio se ve a una persona en pantalla — un
  gancho engancha mucho más con una cara desde el segundo 0 que con un plano vacío. Si no se ve,
  adelanta el inicio un poco (ajuste local, sin IA) como mejor intento; nunca bloquea ni hace
  fallar el clip (cualquier fallo se ignora y se usa el `startSec` original). Deliberadamente
  limitado a UNA llamada por clip (no una búsqueda iterativa) para no disparar el gasto del cupo
  diario gratuito en vídeos con muchos clips — configurable con `ENABLE_HOOK_FRAME_CHECK`. No está
  aplicado (todavía) al modo Ranking, que ya hace su propio análisis de visión por candidato
  (`rankingAnalyze.ts`, hasta 90 llamadas); antes de replicarlo ahí, calcula primero el coste
  combinado con números reales, no lo des por hecho.
- La duración del clip (`CLIP_MIN_SECONDS`/`CLIP_MAX_SECONDS`, por defecto 60-180s) se fuerza en
  **código** (`parseClips` en `analyze.ts`), no solo se pide en el prompt — un clip corto no cuenta
  como visualización monetizable en TikTok/YouTube, y confiar solo en que la IA respete la duración
  pedida ya falló en la práctica.

## Subtítulos (`src/lib/pipeline/bigCaptions.ts`, `transcribe.ts`)

Hubo dos capas de subtítulo a la vez (una pequeña abajo + esta grande del centro); se quitó la de
abajo por completo a petición expresa ("hay dos subtítulos, no sé por qué, quiero que elimines el
de abajo") — no la vuelvas a añadir sin que se pida explícitamente otra vez (ver la contradicción
histórica más abajo: este proyecto ya ha ido y venido sobre "cuánto texto grande" varias veces).

**Única capa actual**: `bigCaptions.ts` + `buildBigCaptionsAss`, `ENABLE_BIG_CAPTIONS`. 2-4
palabras por golpe (corta por pausa real al hablar, no por conteo fijo), fuente `Comic Neue`
(redondeada, a petición expresa — no uses una geométrica/angulosa sin que se pida), en **blanco**
por defecto, y la palabra EXACTA que se está diciendo en ese instante cambia a **verde** (`00FF66`)
y se agranda un ~25% mientras dura, volviendo a blanco/tamaño normal en cuanto termina de decirse
— efecto "karaoke" pedido explícitamente ("cada vez que se lea esa palabra que se cambie de color
... y se haga un poco más grande ... cuando termine se vuelva al tamaño original"). Esto NO es un
cambio de color por golpe entero (esa era la versión anterior, con una paleta que ciclaba
verde/blanco/amarillo/naranja) — es por PALABRA suelta dentro del golpe, usando los timestamps de
palabra de la transcripción. Implementación: por cada golpe de palabras, se generan varias
`Dialogue` consecutivas (una por cada ventana "esta palabra activa" + huecos "ninguna activa" entre
palabras), cada una con el texto completo del golpe pero solo la palabra de esa ventana envuelta en
tags `{\c...\fscx125\fscy125}...{\c...\fscx100\fscy100}` — así el resto de palabras se quedan
quietas en su sitio y solo la que se dice en ese instante "salta". Tamaño y contorno más grandes
que la versión anterior (antes `width/18`, ahora `width/14`, con más grosor de contorno) — pedido
tras ver el resultado en vídeo real ("hazlo un poco más grande y la letra más gorda").

Va en `.ass` (no `.srt`) porque necesita color/tamaño distintos DENTRO de la misma línea, algo que
un `.srt` plano no soporta; el color/contorno/posición van con tags
`{\an5\pos(x,y)\c...\3c...\bord...\blur...}` dentro del propio texto de cada `Dialogue`, no con
`force_style` (eso solo aplica un único estilo fijo para todo el archivo) — y la posición va con
`\pos()` explícito, NO con `MarginV` del Style: con `Alignment=5` (centro) libass no siempre
respeta `MarginV` para desplazar verticalmente, así que `\pos()` es la única forma fiable.

**Modo Ranking** (`rankingRender.ts`) usa esta MISMA capa (`buildBigCaptionsAss`/`bigCaptionsPath`)
para los subclips de cada puesto — antes usaba la capa de abajo que ya no existe; si no se
sustituye, Ranking se queda sin ningún subtítulo quemado.

**Tarjeta de título en modo Ranking**: `rankingRender.ts` (`assembleRankingVideo`) SOLO añade la
tarjeta de título general (fondo negro, texto centrado vía `renderTitleCard`) cuando
`config.commentary.enabled` es `true` — igual que en modo SINGLE. Antes se añadía siempre, sin
condición: si el título general que generaba la IA salía corto (una sola palabra, en minúsculas),
se veía como una palabra enorme sobre fondo negro al principio del vídeo, y el usuario lo confundió
con un "subtítulo grande" nuestro (razonablemente, visualmente lo parecía) y pidió quitarlo. Las
tarjetas POR PUESTO ("#N\n{label}", una antes de cada clip del ranking) siguen añadiéndose siempre
sin condición — esas SÍ son necesarias para que un vídeo de ranking tenga sentido (si no, no se
sabe qué puesto es cada clip); no las quites sin que se pida específicamente eso.

**Ojo con la contradicción histórica**: antes de esto, el usuario pidió explícitamente quitar TODO
texto grande sobre el vídeo (incluido un overlay del número de puesto en modo Ranking, que sigue
sin existir — eso no ha vuelto). El texto grande que SÍ existe ahora es únicamente esta segunda
capa de captions, pedida después con un ejemplo concreto. Si en el futuro el usuario vuelve a decir
"quita las letras grandes" sin más contexto, pregunta primero a cuál de las dos veces se refiere en
vez de asumir — ya ha cambiado de opinión una vez sobre esto mismo.

## Editor post-render (`src/lib/pipeline/regenerateClip.ts`, `src/app/clips/[id]/edit/`)

Pedido explícito: poder editar/borrar los subtítulos automáticos y añadir texto libre (fuente,
color, tamaño, posición arrastrable con el dedo) DESPUÉS de que el clip ya esté generado, sin tener
que rehacer el vídeo entero desde cero.

**Por qué hace falta guardar las cues en la base de datos**: el subtítulo va quemado en los píxeles
del vídeo — no se puede "editar" un `.mp4` ya renderizado, hay que volver a cortarlo desde el vídeo
fuente. Por eso `Clip.captionCues` (JSON) guarda los golpes generados (texto + timestamps por
palabra) en vez de borrarlos tras el render como se hacía antes, y `Clip.effectiveStartSec` guarda
el `startSec` real usado (tras el ajuste de `hookFrame.ts`) para poder re-cortar exactamente igual
sin gastar otra llamada de IA de visión. `Clip.customTexts` (JSON) guarda los textos que el usuario
añade a mano en el editor.

**`bigCaptions.ts` separa generar cues de renderizarlas** a propósito: `cuesFromTranscript` deriva
los golpes de la transcripción (se llama una vez, al generar el clip por primera vez, y el
resultado se guarda); `buildBigCaptionsAssFromCues` renderiza el `.ass` a partir de una lista de
cues YA agrupadas — la llama tanto la generación inicial como el editor al regenerar, así que
cualquier cambio en cómo se ve el caption tiene que vivir en `buildBigCaptionsAssFromCues`/
`defaultBigCaptionsStyle`, no en `cuesFromTranscript` (eso solo agrupa, no dibuja). Un golpe con
`editedText` (el usuario cambió el texto) se renderiza en blanco fijo sin resaltado por palabra,
porque los timestamps por palabra ya no corresponden al texto nuevo — es intencional, no un bug.

**`buildCustomTextAss`** es la capa de texto libre del usuario: a diferencia del caption automático
(un único `Style` de ASS compartido), aquí cada elemento lleva su propia fuente/tamaño/color como
tags inline `\fn`/`\fs`/`\c`, porque cada uno puede ser completamente distinto al de al lado.
`clip.ts` la añade como tercera capa opcional del filtro (`customTextPath`), después del caption
grande.

**`regenerateClip.ts`** reproduce los mismos pasos que `runPipeline.ts` (cortar cuerpo → envolver
con comentario narrado si lo llevaba → envolver con portada si `ENABLE_COVER_CARD`) pero partiendo
de las cues/textos guardados en vez de analizar la transcripción de nuevo, y sin repetir la
comprobación de gancho. Necesita que el vídeo fuente (`Job.sourceFilePath`) siga en disco — se
conserva mientras el job exista (la caché de `storage/` de `server.yml` lo sobrevive entre
reinicios de la sesión), pero si el job es muy antiguo o se ha limpiado a mano, el regenerado
falla con un mensaje claro en vez de romperse a medias.

**Fuentes del selector del editor**: `Bebas Neue`/`Montserrat`/`Lobster` están empaquetadas para
apt en Ubuntu (no verificado en Debian, la imagen Docker usa Debian bookworm), así que las 10
fuentes del selector se descargan igual, directamente del repo oficial `google/fonts` (licencia
libre OFL/Apache), en un paso propio de `server.yml`/`generate.yml`/ambos `Dockerfile*`. Ojo con
los nombres de archivo: varias son "variable fonts" (`Nombre[wght].ttf`) y curl interpreta `[`/`]`
sin codificar como un rango/glob, no como parte literal de la URL — hay que usar `%5B`/`%5D`. Se
verificó cada URL una a una (con `curl -o /dev/null -w "%{http_code}"`) y se hizo un render real de
prueba con `ffmpeg` antes de darlo por bueno — no asumas que un nombre de fuente "suena bien" existe
tal cual en el repo, algunas familias solo tienen variable font (sin estáticas) y otras están en
`apache/` en vez de `ofl/` según su licencia. Si añades una fuente nueva, sigue el mismo patrón:
verifica la URL real antes de escribirla en el workflow.

## Zoom dinámico / ritmo de cámara (`src/lib/pipeline/clip.ts`)

Un plano fijo durante 60-180s seguidos se siente estático y pierde audiencia. El patrón
implementado invierte cuál es la base: el recorte vertical (zoom, sin barras de fondo desenfocado)
es la vista POR DEFECTO la mayor parte del tiempo, y el plano ancho original (con barras) solo
aparece en ráfagas cortas (~1.8s cada ~12s) — al revés de como se hizo la primera vez; se cambió a
petición expresa ("la mayoría en vertical, alguna que otra escena en horizontal"), así que si
alguna vez hay que tocar esto de nuevo, la base debe seguir siendo el recorte vertical, no el plano
ancho. El desfase varía por clip (derivado de su `startSec`) para que no todos los clips del mismo
vídeo "abran" al plano ancho a la vez. Es configurable con `ENABLE_DYNAMIC_ZOOM`.

Detalle técnico importante si tocas esto: el recorte de zoom siempre es centrado (no hay detección
de cara/sujeto), así que funciona bien cuando la acción está más o menos centrada pero puede
recortar mal si el sujeto está muy a un lado — es una limitación conocida y aceptada, no un bug.
Pendiente propuesto (no implementado, coméntalo antes de meterlo): usar detección de cortes de
plano reales del vídeo fuente (p.ej. el filtro `scdet` de ffmpeg, sin coste de IA) para alinear las
ráfagas de plano ancho con cambios de plano reales en vez de un ciclo fijo, y para elegir CUÁNDO
mostrar cada plano de forma realmente estratégica (el usuario lo ha pedido más de una vez: "que el
zoom y cada escena estén escogidas estratégicamente para entretener"). Ahora mismo el ciclo es
puramente por tiempo (no por contenido) porque un análisis por escena con IA para decidir esto
tendría el mismo riesgo de presupuesto diario que ya se evitó a propósito en `hookFrame.ts` — no lo
metas sin verificar antes el coste real con números, como se hizo allí.

Codificación: `-preset fast -crf 18` (subido desde `veryfast`/`crf 20`) a petición expresa de "la
mejor calidad posible" — no lo subas más (p.ej. `medium`/`slow`) sin comprobar antes cuánto alarga
el tiempo de render por clip, el runner de GitHub Actions es compartido con el resto del trabajo.

## Portada de marca / sonido de marca (`src/lib/pipeline/coverCard.ts`, `assets/audio/brand_sting.wav`)

Cada short abre y cierra con la MISMA portada (`ENABLE_COVER_CARD`, activado por defecto): un
fotograma del propio vídeo a máxima calidad (`extractCoverFrameAt` en `clip.ts` — NO uses
`extractFrameAt`, esa es la versión pequeña de 480px para clasificación barata por IA, no sirve
para una portada) con el título del clip quemado encima estilo miniatura de creador real (blanco,
negrita, contorno grueso, degradado inferior de varias `drawbox` apiladas en vez de una caja plana,
más una insignia con el nombre del canal cerca de arriba para reforzar que es contenido de un
creador real — pedido explícito y repetido: "que estén curradas... que parezca de un creador de
contenido"), congelado mientras suena `assets/audio/brand_sting.wav`. Se renderiza UNA sola vez por
clip y se reutiliza el mismo archivo dos veces al montar el vídeo final
(`concatClips([cover, core, cover], outPath)`) — no lo regeneres dos veces, es coste de render
duplicado sin necesidad.

**Bug real corregido — el fotograma NO era el que la IA verificó**: `hookFrame.ts` comprueba con
visión si hay una persona clara, pero NO en `startSec` a secas, sino en `startSec + 0.4s`
(`CHECK_OFFSET_SEC`, para esquivar el fotograma justo en el corte, que suele salir negro/borroso).
La portada, sin embargo, extraía el fotograma en `hookStartSec` tal cual — el instante que NUNCA se
verificó, precisamente el que el offset existe para evitar. Por eso a veces salía un fotograma
sin la persona bien visible pese a que la comprobación de IA había "pasado". Corregido exportando
`hookVerifiedFrameSec(startSec, endSec)` desde `hookFrame.ts` (la misma cuenta que usa
internamente) y usándolo también en `runPipeline.ts` al llamar a `renderCoverCard` — si tocas esto,
la portada SIEMPRE debe pedir el fotograma de `hookVerifiedFrameSec(...)`, nunca de `hookStartSec`
directamente, o vuelve el mismo bug.

El sonido de `assets/audio/brand_sting.wav` es 100% sintetizado desde cero (ondas generadas por
código, sin muestras de terceros) precisamente para evitar cualquier reclamación de copyright en
un canal que publica en automático — si algún día se cambia el sonido, que el nuevo también sea
original o de licencia libre verificada, nunca una canción/efecto con copyright real, dado el
volumen de publicación automática de este proyecto.

`probeAudioDurationSec` (en `probe.ts`) existe aparte de `probeVideo` porque este último pide
`-select_streams v:0` y falla con un archivo de solo audio como el sting — no reutilices
`probeVideo` para archivos de audio.

**Bug real corregido — parámetros de códec desalineados al concatenar por copia**:
`concatClips` usa `-c copy` (sin recodificar) para unir cuerpo + tarjetas + portada. Eso EXIGE que
todos los tramos compartan exactamente fps de vídeo y frecuencia/canales de audio — si no, la
concatenación queda con metadatos que no encajan con los timestamps reales de cada tramo. Antes de
esta corrección, `renderCoverCard` (imagen fija en loop, fps por defecto de ffmpeg = 25, audio mono
del `.wav` de marca) y `renderTitleCard` (fondo `color=` de lavfi, fps por defecto 25) no
coincidían con `cutVerticalClip` (fps nativo del vídeo fuente, con frecuencia variable, audio
estéreo) — eso se manifestó como sonido que desaparecía en algún tramo y el vídeo entero pareciendo
ir a cámara lenta en el reproductor, justo lo reportado. Arreglado con tres constantes compartidas
en `clip.ts` (`CONCAT_FPS=30`, `CONCAT_AUDIO_SAMPLE_RATE=44100`, `CONCAT_AUDIO_CHANNELS=2`) forzadas
con `-r`/`-ar`/`-ac` en los TRES sitios que generan tramos que acaban concatenados por copia:
`cutVerticalClip`, `renderTitleCard` y `renderCoverCard`. Si añades una función nueva que genere un
tramo que se vaya a concatenar con `concatClips`, tiene que forzar estas mismas tres constantes —
si no, vuelve el mismo bug. `-r` no cambia la velocidad real del contenido (solo remuestrea cuántos
fotogramas por segundo se cuentan para la misma duración), así que es seguro forzarlo igual en
todos los tramos sin alterar el ritmo real del vídeo.

**No hay ffmpeg disponible en el entorno de desarrollo** para probar filtros nuevos en vivo — solo
se despliega y se comprueba en el servidor real de GitHub Actions. Antes de escribir un filtro
`-filter_complex` nuevo, reutiliza el mismo patrón de escapado/estructura ya probado en
`buildVerticalFilter` (scale + crop + overlay, comillas simples para proteger comas/dos puntos
dentro de un valor de opción) en vez de inventar sintaxis sin verificar — un filtro mal escrito
falla en producción sin forma fácil de depurarlo interactivamente.

## Hashtags (`src/lib/trends/hashtags.ts`)

Nada de hashtags genéricos/random. El público objetivo por defecto de este canal es el de
comedia/entretenimiento de la plataforma (ver `CHANNEL_NICHE`), y cada hashtag sugerido debe
justificar su hueco:
- 2-3 de **alto volumen** que ese público concreto usa para descubrir contenido nuevo.
- 4-6 de **nicho**, atados a lo que pasa en el clip concreto (no genéricos para cualquier vídeo).
- 1-2 de **marca/canal**.

## Restricciones del proyecto que hay que respetar en cualquier cambio

- **El usuario es menor de edad, sin tarjeta de crédito.** Todo tiene que funcionar en el nivel
  gratuito de cada servicio (GitHub Actions, Groq/Gemini free tier, Cloudflare Quick Tunnel sin
  cuenta, `faster-whisper` local, Piper TTS local). No propongas soluciones de pago, ni workarounds
  arriesgados para las cuentas del usuario (p.ej. extracción de cookies de sesión real, registradores
  de dominio gratuitos/dudosos) aunque resuelvan el problema más rápido — declina y explica por qué.
- **Los workflows de GitHub Actions pueden silenciar cambios de `config.ts` sin avisar.** Ya ha
  pasado varias veces en este proyecto: `CHANNEL_LANGUAGE` y `ENABLE_COMMENTARY` llevaban semanas
  sobreescritos con un valor fijo en `server.yml`/`generate.yml` que anulaba en silencio el nuevo
  valor por defecto de `config.ts`, y por separado `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/
  `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` nunca se reenviaban al proceso aunque estuvieran
  configurados como secretos de GitHub. Cuando cambies un valor por defecto o añadas una variable
  de entorno nueva en `config.ts`, comprueba siempre si `.github/workflows/server.yml` y
  `generate.yml` la fijan a un valor distinto (o si falta reenviarla del todo).
- Verifica los cambios con `npx tsc --noEmit` y `npm run build` antes de darlos por buenos — es lo
  único verificable en este entorno sin acceso a un servidor real con ffmpeg.
