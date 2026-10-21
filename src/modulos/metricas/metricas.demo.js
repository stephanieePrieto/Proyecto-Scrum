/**
 * @file metricas.demo.js
 * @description HU-35: Dashboard de KPIs.
 * Proveer datos de ejemplo para que el endpoint funcione sin base de datos.
 * ELIMINAR este archivo (y sus usos) cuando la base de datos esté disponible.
 */

/**
 * Determinar si el módulo debe responder con datos de ejemplo.
 * Activar el modo demo cuando MODO_DEMO=true o cuando no existe DATABASE_URL.
 * Desactivarlo con MODO_DEMO=false aunque falte DATABASE_URL.
 *
 * @returns {boolean} true si se deben usar datos de ejemplo.
 */
export function esModoDemo() {
  if (process.env.MODO_DEMO === 'true') return true;
  if (process.env.MODO_DEMO === 'false') return false;
  return !process.env.DATABASE_URL;
}

/**
 * Definir las respuestas de ejemplo, una por escenario.
 * Imitar exactamente el formato real: { vacio, kpis: { ... } }.
 * Representar un KPI con fallo mediante { error: true }.
 */
const ESCENARIOS = {
  // Representar un proyecto con datos y un sprint activo
  normal: {
    vacio: false,
    kpis: {
      avance: { valor: 74, hechas: 37, total: 50 },
      diasRestantes: { valor: 4 },
      impedimentos: { valor: 2, criticos: 1 },
      desviacion: { valor: -8, estimado: 160, real: 152 },
    },
  },
  // Representar un proyecto sin sprint activo (días restantes en null)
  sinsprint: {
    vacio: false,
    kpis: {
      avance: { valor: 32, hechas: 8, total: 25 },
      diasRestantes: { valor: null },
      impedimentos: { valor: 0, criticos: 0 },
      desviacion: { valor: 3, estimado: 80, real: 83 },
    },
  },
  // Representar un proyecto nuevo sin información
  vacio: { vacio: true, kpis: {} },
  // Representar el fallo de un solo KPI (impedimentos)
  parcial: {
    vacio: false,
    kpis: {
      avance: { valor: 74, hechas: 37, total: 50 },
      diasRestantes: { valor: 4 },
      impedimentos: { error: true },
      desviacion: { valor: 14, estimado: 100, real: 114 },
    },
  },
};

/**
 * Obtener la respuesta de ejemplo de un escenario.
 * Lanzar un error en el escenario "falla" para probar el fallo total (HTTP 500).
 * Usar "normal" cuando el escenario no existe o no se indica.
 *
 * @param {string} [escenario] normal, sinsprint, vacio, parcial o falla.
 * @returns {{vacio: boolean, kpis: Object}} Datos de ejemplo.
 */
export function datosDemo(escenario) {
  if (escenario === 'falla') throw new Error('Demo: fallo simulado del servidor');
  return ESCENARIOS[escenario] || ESCENARIOS.normal;
}