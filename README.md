# Buenos Hábitos

Prototipo web de una app que te obliga a completar tus tareas antes de "liberar" el móvil.
Pensada para hábitos que sabes que vas a posponer: ir al gimnasio, ponerte el Invisalign
después de comer, tomar agua, etc.

## ¿Qué hace?

- **Tareas con hora fija** (ej. "Ir al gimnasio" todos los días laborables a las 18:00).
- **Tareas en franja horaria** para cosas sin hora exacta (ej. "Beber agua entre las 9 y las 11").
- **Eventos + tareas encadenadas**: defines un evento manual como "Acabo de comer" y pulsas el
  botón en el momento en que ocurre; las tareas vinculadas (ej. "Ponerme el Invisalign") se
  activan automáticamente X minutos después.
- **Pantalla de bloqueo a pantalla completa**: cuando una tarea marcada como "🔒 Bloquea" está
  pendiente, aparece una pantalla que cubre toda la app y no se puede cerrar hasta mantener
  pulsado el botón "Ya lo hice ✅" (para evitar marcarla sin querer o de pasada).
- Aplazamientos limitados (3 al día, 5 min cada uno), alarma sonora en bucle, aviso al volver
  de cambiar de app, y aviso al intentar cerrar la pestaña.
- Rachas (🔥) y progreso semanal por tarea, guardado en el propio navegador (`localStorage`).

## Cómo probarla

**Opción rápida (recomendada para iPhone):** abre `dist/buenos-habitos.html` directamente en
Safari (es un único archivo, sin instalación ni servidor). Luego pulsa **Compartir → Añadir a
pantalla de inicio** y ábrela siempre desde ese icono, no desde Safari — así arranca sin barra
de navegador y no puedes deslizar hacia atrás para saltarte el bloqueo.

**Opción con servidor** (para desarrollo, usa los ficheros sueltos):

```bash
python3 -m http.server 8080
# abre http://localhost:8080 en el móvil o el navegador
```

## Bloqueo máximo posible en iPhone

Apple no permite que ninguna app de terceros —ni nativa ni web— controle el sistema operativo
para impedirte de verdad usar el móvil. Eso solo lo deciden las funciones propias de iOS. Esta
app ya hace lo máximo posible desde el navegador (pantalla que lo cubre todo, no se cierra sin
mantener pulsado el botón, alarma en bucle, vibración, aviso si cambias de app, e impide que la
pantalla se apague sola con Wake Lock). Para ir más allá, combínala con esto:

1. **Acceso Guiado** (lo más fuerte que existe en iOS): Ajustes → Accesibilidad → Acceso
   Guiado → actívalo y pon un código (que no sea el mismo que el de desbloqueo del móvil, o
   pídele a otra persona que lo escriba). Cuando suene la alarma, abre la app y haz **triple
   clic** en el botón lateral: el iPhone queda bloqueado en esa única pantalla, sin poder tocar
   otras apps ni el botón de inicio, hasta que se introduzca el código. Es manual (tienes que
   activarlo tú cada vez), pero es la única función de iOS que de verdad "secuestra" el teléfono.
2. **Tiempo en pantalla** (Ajustes → Tiempo en pantalla): pon un límite diario o una franja de
   "Tiempo de inactividad" a las apps que te distraen (redes sociales, juegos). iOS las bloqueará
   de verdad con su propio código, que puede tenerlo otra persona.
3. **Atajos (Shortcuts) + Automatizaciones**: crea una automatización personal por hora del día
   (ej. 18:00) que abra esta app automáticamente, para que la alarma te salte sin que tengas que
   acordarte de abrirla tú.

Si más adelante quieres ir a por el bloqueo automático (sin acción manual de tu parte) en iPhone,
la única vía real es publicar una app en la App Store usando el **Screen Time API / Family
Controls** de Apple — un framework que requiere aprobación especial de Apple y está pensado sobre
todo para apps de control parental, pero permitiría bloquear apps del sistema hasta que se
cumpla una condición. Es un desarrollo bastante más grande (cuenta de desarrollador, revisión de
Apple, etc.) — dime si quieres que lo planifiquemos.

## Límite importante (léelo antes de confiar en esto)

Esto es un **prototipo dentro del navegador**. El bloqueo solo cubre la pestaña/web mientras
está abierta:

- Si cambias de app o apagas la pantalla, esta web no puede impedirlo ni recuperar el control
  (solo te avisa con un aviso y una vibración cuando vuelves a ella).
- Si cierras la pestaña o app, se pierde el bloqueo (solo se muestra una advertencia genérica
  al intentarlo).
- No hay proceso en segundo plano: si iOS suspende la app, la alarma no sonará hasta que la
  vuelvas a abrir (por eso la automatización de Atajos del punto 3 de arriba ayuda mucho).

Para un bloqueo automático de todo el móvil sin depender de estas combinaciones manuales,
hace falta una app nativa (Android lo permite con permisos de superposición y accesibilidad;
en iPhone requiere el Screen Time API descrito arriba). Si el concepto te convence tras probar
este prototipo, ese sería el siguiente paso.

## Estructura

- `index.html` / `styles.css` / `app.js` — código fuente de desarrollo (ficheros separados).
- `manifest.json` / `assets/icon.svg` — metadatos para "instalar" la web como PWA en Android.
- `dist/buenos-habitos.html` — **versión de un solo archivo** (CSS y JS embebidos) pensada para
  abrir directamente en Safari en iPhone sin necesidad de servidor. Regenerar con:
  ```bash
  node -e "$(cat <<'EOS'
  const fs = require('fs');
  let html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('styles.css', 'utf8');
  const js = fs.readFileSync('app.js', 'utf8');
  const iconDataUri = 'data:image/svg+xml;base64,' + Buffer.from(fs.readFileSync('assets/icon.svg','utf8')).toString('base64');
  html = html.replace('<link rel="manifest" href="manifest.json" />\n', '');
  html = html.replace('<link rel="apple-touch-icon" href="assets/icon.svg" />', `<link rel="apple-touch-icon" href="${iconDataUri}" />`);
  html = html.replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${css}\n</style>`);
  html = html.replace('<script src="app.js"></script>', `<script>\n${js}\n</script>`);
  fs.writeFileSync('dist/buenos-habitos.html', html);
  EOS
  )"
  ```
