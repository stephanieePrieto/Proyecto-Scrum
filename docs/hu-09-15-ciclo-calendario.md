# HU-09 Iniciar y cerrar sprint y HU-15 Calendario de eventos Scrum (Sprint 3 · Diego)

Pantallas: `/pages/sprint-detalle.html` (HU-09) y `/pages/calendario.html` (HU-15); ambas aceptan `?proyecto=ID`.
Módulos: `src/modulos/ciclo-sprint` y `src/modulos/calendario` (`app.js` los monta en `/api/ciclo-sprint` y `/api/calendario`).
Permisos usados (ya existían): `proyecto.ver` para consultar y `sprint.gestionar` (solo Scrum Master) para iniciar y cerrar.

## HU-09 · Iniciar y cerrar sprint

### GET `/api/ciclo-sprint/proyecto/:proyectoId`
`{ activo, planificados[], roles, yo, puedeGestionar }`. Cada sprint planificado trae `faltantes[]` (qué le falta para iniciar) y `bloqueadoPorActivo`.

### POST `/api/ciclo-sprint/sprint/:id/iniciar`  `{ objetivo, capacidad_horas }`
Confirma objetivo y capacidad y pasa el sprint a `activo` (habilita el tablero).
- Bloquea con 400 y `detalles.faltantes` si no hay objetivo, capacidad o historias, o si el proyecto no tiene Scrum Master o Product Owner activos.
- Si ya hay un sprint activo → 409 `Ya existe un sprint activo en este proyecto.` Si dos Scrum Masters lo intentan a la vez, el índice único `ux_un_sprint_activo_por_proyecto` deja pasar solo a uno.
- Genera los eventos del calendario (HU-15).

### GET `/api/ciclo-sprint/sprint/:id/resumen`
Historias, puntos, **velocity** (puntos de historias `hecho` o `aceptada`), `enRevision[]` (historias con tarjetas en una columna "En revisión") y el `siguiente` sprint planificado.

### POST `/api/ciclo-sprint/sprint/:id/cerrar`  `{ destino: 'backlog'|'siguiente', siguienteSprintId?, revision: 'hecho'|'pendiente' }`
- Con tarjetas en revisión exige `revision` (`hecho` las da por terminadas; `pendiente` las trata como no terminadas).
- Con historias no terminadas exige `destino`. `siguiente` sin sprint planificado → 400 "Créalo primero".
- Todo ocurre en una transacción con el sprint bloqueado: si falla, no cambia nada. Reintentar sobre un sprint ya cerrado devuelve `yaCerrado: true` sin duplicar.
- Las historias no terminadas (y sus tareas) pasan al sprint siguiente o vuelven al backlog (`sprint_id = NULL`, `estado = 'backlog'`). Guarda `velocity` y `cerrado_en`.
- Sockets: `sprint:iniciado`, `sprint:cerrado`.

## HU-15 · Calendario de eventos Scrum

### GET `/api/calendario/proyecto/:proyectoId`
`{ zona, sprint, eventos[], conflictos[], mensaje }`. Sin sprint activo devuelve `eventos: []` y un `mensaje`.
- Eventos del sprint activo, en días hábiles: **Planning** (primer día), **Daily** (resto de días, 09:30–09:45), **Review** y **Retro** (último día). Horarios en `HORARIOS` de `calendario.reglas.js`, definidos en `America/Mexico_City` (`ZONA_EVENTOS`).
- Las horas viajan en UTC; la pantalla las muestra en `usuarios.zona_horaria` de quien consulta.
- **Regeneración:** cada consulta compara los eventos guardados con los que corresponden a las fechas del sprint; si cambiaron (por ejemplo, alguien editó las fechas), los regenera y notifica a los integrantes (tabla `notificaciones`, tipo `calendario`). Hay un candado por sprint para no duplicar. Otros módulos pueden llamar a `regenerar(proyectoId)`.
- **Conflictos:** eventos que caen en una ausencia (`ausencias`) del Scrum Master o Product Owner.
- La Daily generada alimenta la marca "tarde" de HU-10: un registro es tarde si se crea después de que termina esa Daily.
- Socket: `calendario:actualizado`.

## Pruebas
`node --test src/modulos/ciclo-sprint/ciclo-sprint.test.js src/modulos/calendario/calendario.test.js`
