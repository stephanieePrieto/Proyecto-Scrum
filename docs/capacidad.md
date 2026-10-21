# Capacidad individual

Cada integrante define cuántas horas puede trabajar por día y qué días no estará disponible
(ausencias y vacaciones). Con eso se calcula la capacidad del equipo en un sprint.

## Endpoints

Todos cuelgan de `/api`. Las rutas se montan en `src/app.js`.

### GET `/api/usuarios/:usuarioId/capacidad`

Devuelve lo guardado. `horasPorDia` es `null` si la persona aún no lo captura.

```json
{
  "usuarioId": 1,
  "horasPorDia": 6,
  "notas": "Disponible para apoyo en QA",
  "ausencias": [
    { "id": 1, "tipo": "vacaciones", "fechaInicio": "2026-10-22", "fechaFin": "2026-10-23" }
  ]
}
```

### PUT `/api/usuarios/:usuarioId/capacidad`

Reemplaza las horas, las notas y todas las ausencias. Solo la propia persona o un `Admin` pueden usarlo.

```json
{
  "horasPorDia": 6,
  "notas": "Disponible para apoyo en QA",
  "ausencias": [
    { "tipo": "ausencia", "fechaInicio": "2026-10-14", "fechaFin": "2026-10-18" },
    { "tipo": "ausencia", "fechaInicio": "2026-10-16", "fechaFin": "2026-10-20" }
  ]
}
```

Respuesta: lo guardado más `fusionadas` (cuántas ausencias traslapadas se unieron) y `mensaje`.

| Estado | Cuándo |
|---|---|
| 400 | Horas fuera de 0–24, fechas inválidas, fin anterior al inicio, notas de más de 500 caracteres. Incluye `errores: [{ campo, mensaje }]` |
| 403 | Se intenta editar la capacidad de otra persona sin ser Admin |

### GET `/api/equipos/:equipoId/capacidad?inicio=AAAA-MM-DD&fin=AAAA-MM-DD`

Calcula las horas del equipo en el rango (ambas fechas incluidas). Se recalcula en cada consulta.

```json
{
  "miembros": [
    { "usuarioId": 1, "nombre": "Laura Méndez", "configurado": true, "horas": 48, "diasHabiles": 8, "diasAusente": 2 },
    { "usuarioId": 3, "nombre": "Ana Soto", "configurado": false, "horas": 0, "diasHabiles": 0, "diasAusente": 0 }
  ],
  "totalHoras": 48,
  "sinCapacidad": false
}
```

- `sinCapacidad: true` cuando el total es 0 h; la pantalla de planificación debe mostrar la advertencia.
- Quien no ha capturado sus horas aporta 0 h y aparece con `configurado: false`.
- Para usarlo desde otro módulo: `obtenerCapacidadEquipo(equipoId, { inicio, fin })` en `capacidad.service.js`.

## Reglas de cálculo

- Se cuentan solo lunes a viernes. No hay calendario de festivos.
- Las ausencias fuera del rango no afectan; las que lo cruzan solo cuentan en la parte interna.
- Las ausencias que comparten al menos un día se fusionan. Dos rangos contiguos sin días en común no.
- Si se fusionan una ausencia y unas vacaciones, se conserva el tipo del rango que empieza primero.

## Base de datos

`database/capacidad.sql` crea `capacidad_usuarios` y `ausencias`. Requiere la tabla `usuarios(id)`.
El service también supone `equipo_miembros(equipo_id, usuario_id)`. Si los nombres reales son otros,
se ajustan en las consultas de `capacidad.service.js`.

## Probar sin base de datos (modo demo)

Con `MODO_DEMO=true` (o sin `DATABASE_URL`) el módulo usa datos de ejemplo en memoria
(`capacidad.demo.js`) y no exige sesión.

```
MODO_DEMO=true npm run dev
```

Abrir `http://localhost:3000/pages/capacidad.html?usuario=1&equipo=1`.
Para probar la advertencia de 0 horas, usar `?usuario=3&equipo=1` y dejar las horas en 0 en todo el equipo.

Al conectar la base de datos, eliminar `capacidad.demo.js` y sus usos en `capacidad.service.js` y `capacidad.routes.js`.

## Pruebas automáticas

```
node --test src/modulos/capacidad/capacidad.test.js
```

## Pendiente de integrar

- Enlace a `/pages/capacidad.html` en el menú (`js/core/layout.js`) o desde la pantalla de equipos.
- `autenticar` debe dejar `req.user = { id, rol }`; la pantalla toma el id de `localStorage` (`usuario.id`) o de `?usuario=`.
