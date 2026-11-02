# HU-10 Daily Scrum y HU-11 Impedimentos (Sprint 2 · Diego)

Pantallas: `/pages/daily.html` y `/pages/impedimentos.html` (ambas aceptan `?proyecto=ID`).
Módulos: `src/modulos/daily` y `src/modulos/impedimentos` (`app.js` los monta en `/api/daily` y `/api/impedimentos`).
Permisos nuevos en `utils/permisos.js`: `daily.registrar` e `impedimento.gestionar` (los tres roles). Ver datos: `proyecto.ver`.

## HU-10 · Daily Scrum

### GET `/api/daily/proyecto/:proyectoId?fecha=AAAA-MM-DD`
Estado del equipo ese día (por omisión, hoy en la zona horaria de quien consulta).
Devuelve `sprint` (null si no hay sprint activo), `soloLectura` (días anteriores), `puedeRegistrar`, `horaCorte`,
`miembros[]` con `estado` (`registrado` | `tarde` | `ausente` | `pendiente`) y su `daily` (ayer, hoy, impedimentos, tareas),
`resumen` con los contadores y `tareas[]` del sprint para los chips. Fecha futura o inválida → 400.

### PUT `/api/daily/proyecto/:proyectoId`
Registra o edita **mi** Daily de hoy: `{ ayer, hoy, impedimentos?, tareas?: [ids] }`.
- Una Daily por sprint, persona y día: volver a guardar edita, no duplica.
- "Tarde" = se crea después del fin de la Daily del calendario (`eventos_calendario`, HU-15) o, si no hay evento, después de las 10:00 (`HORA_CORTE_DEFECTO` en `daily.reglas.js`). Editar después no cambia la marca.
- Sin sprint activo → 409. Datos inválidos → 400 con `detalles` por campo. Las tareas deben ser del sprint activo.
- Ausencia registrada (`ausencias`) y sin Daily → "ausente", sin penalización.
- Si falla la conexión, la pantalla guarda el texto como borrador en `localStorage`.
- Socket: `daily:registrada` a la sala del proyecto.

## HU-11 · Impedimentos

### GET `/api/impedimentos/proyecto/:proyectoId?estado=abierto|resuelto|todos&severidad=baja|media|alta`
`{ impedimentos, resumen: {abiertos, vencidos, resueltos}, miembros, tareas, yo, diasParaAlerta }`.
Cada impedimento trae `horas_abierto` (hasta ahora o hasta que se resolvió) y `vencido` (abierto por **más de 3 días** → rojo).
Al consultar, los impedimentos abiertos cuyo responsable ya no es integrante activo del proyecto pasan al Scrum Master y se le avisa.

### POST `/api/impedimentos/proyecto/:proyectoId`
`{ titulo, severidad?, responsable_id, tarea_id? }` → 201 `{ impedimento }` abierto. Falta título o responsable → 400 con `detalles` por campo.

### POST `/api/impedimentos/:id/resolver`
Cierra el impedimento y guarda quién y cuándo (`resuelto_por`, `resuelto_en`; el tiempo abierto = `resuelto_en - creado_en`).
Si otra persona lo resolvió antes → 409 `Ya fue resuelto por X.`

### Eventos de socket
`impedimento:creado`, `impedimento:resuelto`, `impedimento:reasignado` (sala del proyecto) e `impedimento:aviso` (sala personal).

### Para otros módulos
`reasignarDeBaja(proyectoId)` (en `impedimentos.service.js`) se puede llamar al dar de baja o quitar a un integrante para reasignar en ese momento.

## Pruebas
`node --test src/modulos/daily/daily.test.js src/modulos/impedimentos/impedimentos.test.js src/modulos/capacidad/capacidad.test.js`
