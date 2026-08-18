---
name: viral-shorts-editor
description: Editorial and technical standards for Escenas Virales Studio's short-form video pipeline in this repo — clip selection, burned subtitles, dynamic zoom/camera pacing, and hashtag strategy. Use this skill whenever working on src/lib/pipeline/analyze.ts, clip.ts, subtitles.ts, transcribe.ts, or src/lib/trends/hashtags.ts, or whenever asked to make shorts more professional/entertaining, fix clip selection quality, adjust subtitle style, add camera movement/zoom effects, or improve hashtags for this channel — even if the user describes it in plain terms ("que los clips sean mejores", "que los subtítulos se vean bien", "que sea más viral") instead of naming these files directly. Also consult it before changing feature-flag defaults in src/lib/config.ts or the GitHub Actions workflows, since this project has a recurring bug pattern of the workflows silently overriding config defaults.
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

## Subtítulos (`src/lib/pipeline/subtitles.ts`, `transcribe.ts`)

Hay DOS capas de subtítulo quemadas a la vez (esto cambió de opinión el usuario a mitad de
conversación tras ver un ejemplo real — no es un despiste, es el estado actual querido):

1. **Abajo, normal** (`subtitles.ts` + `buildSrt`, filtro `subtitles=` con `.srt`): palabra por
   palabra cuando el proveedor de transcripción da marcas de tiempo por palabra — tanto
   `faster-whisper` local (`word_timestamps=True` en `scripts/local_whisper.py`) como la API de
   Whisper (`timestamp_granularities: ["segment","word"]`) las dan; si un proveedor no las diera,
   cae automáticamente a un cue por frase entera. Tamaño de letra normal, en una burbuja
   semitransparente, `ENABLE_SUBTITLES`.
2. **Algo por debajo del centro, grande y de colores** (`bigCaptions.ts` + `buildBigCaptionsAss`,
   SEGUNDA llamada al filtro `subtitles=` pero con un `.ass`, no `.srt`): 2-4 palabras por golpe
   (corta por pausa real al hablar, no por conteo fijo), color distinto cada vez (verde/blanco/
   amarillo/naranja), fuente `Comic Neue` (redondeada, a petición expresa — no uses una geométrica/
   angulosa sin que se pida), tamaño la mitad de lo que empezó siendo (ajustado a petición expresa
   más de una vez, no lo agrandes por tu cuenta), con contorno+desenfoque tipo "brillo/neón" —
   estilo MrBeastClips, pedido explícitamente a partir de capturas reales de referencia.
   `ENABLE_BIG_CAPTIONS`. Usa `.ass` en vez de `.srt` porque un `.srt` plano no soporta color por
   línea; el color/posición van con tags `{\an5\pos(x,y)\c...\3c...\bord...\blur...}` dentro del
   propio texto de cada `Dialogue`, no con `force_style` (eso solo aplica un único estilo fijo para
   todo el archivo) — y la posición va con `\pos()` explícito, NO con `MarginV` del Style: con
   `Alignment=5` (centro) libass no siempre respeta `MarginV` para desplazar verticalmente, así
   que `\pos()` es la única forma fiable de moverlo hacia abajo del centro exacto.

**Ojo con la contradicción histórica**: antes de esto, el usuario pidió explícitamente quitar TODO
texto grande sobre el vídeo (incluido un overlay del número de puesto en modo Ranking, que sigue
sin existir — eso no ha vuelto). El texto grande que SÍ existe ahora es únicamente esta segunda
capa de captions, pedida después con un ejemplo concreto. Si en el futuro el usuario vuelve a decir
"quita las letras grandes" sin más contexto, pregunta primero a cuál de las dos veces se refiere en
vez de asumir — ya ha cambiado de opinión una vez sobre esto mismo.

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
