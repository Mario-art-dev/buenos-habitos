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

Es una web estática, no necesita instalación:

```bash
python3 -m http.server 8080
# abre http://localhost:8080 en el móvil o el navegador
```

En el móvil, usa "Añadir a pantalla de inicio" para que se abra a pantalla completa, sin la
barra del navegador (más parecido a una app real).

## Límite importante (léelo antes de confiar en esto)

Esto es un **prototipo dentro del navegador**. El bloqueo solo cubre la pestaña/web:

- Si cambias de app o apagas la pantalla, esta web no puede impedirlo ni recuperar el control
  (solo te avisa con un aviso y una vibración cuando vuelves a ella).
- Si cierras la pestaña, se pierde el bloqueo (solo se muestra una advertencia genérica del
  navegador al intentarlo).
- Solo funciona mientras la pestaña sigue abierta; no hay proceso en segundo plano.

Para lograr el bloqueo real de todo el móvil que pides ("no pueda usar el móvil hasta
completarlo") hace falta una **app nativa de Android**, usando permisos de superposición
(`SYSTEM_ALERT_WINDOW`), administrador de dispositivo o accesibilidad, y un servicio en
segundo plano. iOS no permite ese nivel de bloqueo a apps de terceros. Si el concepto te
convence tras probar este prototipo, el siguiente paso natural es construir esa versión nativa.

## Estructura

- `index.html` — estructura de la app y modales.
- `styles.css` — estilos (tema oscuro, pensado para móvil).
- `app.js` — lógica: tareas, eventos, cálculo de "pendiente/hecha", pantalla de bloqueo,
  sonido de alarma, rachas. Todo el estado se guarda en `localStorage`, sin backend.
- `manifest.json` / `assets/icon.svg` — para poder "instalar" la web como PWA en el móvil.
