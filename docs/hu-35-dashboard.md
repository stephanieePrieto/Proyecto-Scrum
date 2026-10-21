# HU-35 · Dashboard de KPIs

## Endpoint (agregar a docs/api.md)

`GET /api/proyectos/:proyectoId/metricas/dashboard` (requiere sesión)

```json
{
  "vacio": false,
  "kpis": {
    "avance":        { "valor": 74, "hechas": 37, "total": 50 },
    "diasRestantes": { "valor": null },
    "impedimentos":  { "error": true },
    "desviacion":    { "valor": -8, "estimado": 160, "real": 152 }
  }
}
```

- `diasRestantes.valor = null` → el cliente muestra "—" (sin sprint activo).
- `vacio = true` → el cliente muestra el aviso de proyecto nuevo.
- Un KPI con `{ "error": true }` → solo esa tarjeta muestra error; las demás cargan normal.

## Cambios en src/app.js

```js
import express from 'express';
import metricasRoutes from './modulos/metricas/metricas.routes.js';

// Servir los archivos estáticos (HTML, CSS y JS del cliente) desde /public
app.use(express.static('public'));

// Montar las rutas de métricas bajo el prefijo /api (antes de manejoErrores)
app.use('/api', metricasRoutes);
```

## Modo demo (sin base de datos)

Mientras no exista base de datos, el endpoint responde con datos de ejemplo y no exige login.

- Se activa solo si falta `DATABASE_URL` en el entorno, o con `MODO_DEMO=true`.
- Se desactiva con `MODO_DEMO=false` o al definir `DATABASE_URL`.
- Escenarios: `?escenario=normal | sinsprint | vacio | parcial | falla` en el endpoint.
- Desde la página: `/pages/dashboard.html?demo=sinsprint` (el servidor devuelve el escenario).
- Al tener base de datos: borrar `metricas.demo.js` y sus usos en service y routes.

### Archivos de arranque (CommonJS)

El proyecto usa `"type": "commonjs"`; por eso el backend usa `require` y `module.exports`.
Los archivos `src/app.js` y `src/server.js` incluidos sirven si los tuyos están vacíos.
Si ya tienen contenido, agregar solo estas líneas en `app.js`:

```js
const metricasRoutes = require('./modulos/metricas/metricas.routes');
app.use(express.static('public'));
app.use('/api', metricasRoutes);
```

Agregar en `package.json`:

```json
"scripts": {
  "start": "node src/server.js",
  "dev": "node --watch src/server.js"
}
```

Ejecutar con `npm start` (o `npm run dev` para reiniciar al guardar; requiere Node 18.11+).

### Cuando exista la base de datos (config/db.js)

```js
const { Pool } = require('pg');
module.exports = new Pool({ connectionString: process.env.DATABASE_URL });
```
