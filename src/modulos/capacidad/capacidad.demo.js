/**
 * Proveer datos de ejemplo para que el módulo funcione sin base de datos.
 * Imitar la misma interfaz que el acceso a PostgreSQL del service.
 * Eliminar este archivo (y sus usos en service y routes) cuando la base de datos esté disponible.
 */

/**
 * Determinar si el módulo debe usar datos de ejemplo.
 * Solo se activa de forma explícita con MODO_DEMO=true (las pruebas automáticas lo hacen).
 * El servidor exige PostgreSQL para arrancar, así que ya no se activa por falta de DATABASE_URL:
 * en modo demo las rutas NO piden sesión y no debe quedar encendido por accidente.
 *
 * @returns {boolean} true si se deben usar datos de ejemplo.
 */
export function esModoDemo() {
  return process.env.MODO_DEMO === 'true';
}

/**
 * Crear el estado inicial: un equipo con tres integrantes.
 * El tercero aún no captura su capacidad.
 *
 * @returns {{usuarios: Object, capacidad: Object, ausencias: Object, equipos: Object}}
 */
function estadoInicial() {
  return {
    usuarios: {
      1: { id: 1, nombre: 'Laura Méndez' },
      2: { id: 2, nombre: 'Carlos Ruiz' },
      3: { id: 3, nombre: 'Ana Soto' },
    },
    capacidad: {
      1: { horasPorDia: 6, notas: 'Disponible para apoyo en QA y revisiones de diseño.' },
      2: { horasPorDia: 4, notas: '' },
    },
    ausencias: {
      1: [{ id: 1, tipo: 'vacaciones', fechaInicio: '2026-10-22', fechaFin: '2026-10-23' }],
      2: [],
    },
    equipos: { 1: [1, 2, 3] },
  };
}

let estado = estadoInicial();
let siguienteId = 100;

/** Restablecer los datos de ejemplo (útil en pruebas). */
export function reiniciar() {
  estado = estadoInicial();
  siguienteId = 100;
}

/**
 * Obtener el perfil de capacidad de una persona.
 *
 * @param {number} usuarioId
 * @returns {Promise<{horasPorDia: number, notas: string}|null>} null si aún no lo captura.
 */
async function obtenerPerfil(usuarioId) {
  const perfil = estado.capacidad[usuarioId];
  return perfil ? { ...perfil } : null;
}

/**
 * Listar las ausencias de una persona ordenadas por fecha de inicio.
 *
 * @param {number} usuarioId
 * @returns {Promise<Array<{id: number, tipo: string, fechaInicio: string, fechaFin: string}>>}
 */
async function listarAusencias(usuarioId) {
  return (estado.ausencias[usuarioId] ?? [])
    .map((a) => ({ ...a }))
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
}

/**
 * Reemplazar el perfil y todas las ausencias de una persona.
 *
 * @param {number} usuarioId
 * @param {{horasPorDia: number, notas: string|null, ausencias: Array}} datos
 * @returns {Promise<void>}
 */
async function guardarTodo(usuarioId, { horasPorDia, notas, ausencias }) {
  estado.capacidad[usuarioId] = { horasPorDia, notas: notas ?? '' };
  estado.ausencias[usuarioId] = ausencias.map((a) => ({ id: siguienteId++, ...a }));
}

/**
 * Listar los integrantes de un equipo con su capacidad y sus ausencias.
 *
 * @param {number} equipoId
 * @returns {Promise<Array<{usuarioId: number, nombre: string, horasPorDia: number|null, ausencias: Array}>>}
 */
async function listarMiembros(equipoId) {
  const ids = estado.equipos[equipoId] ?? [];
  return ids.map((id) => ({
    usuarioId: id,
    nombre: estado.usuarios[id].nombre,
    horasPorDia: estado.capacidad[id]?.horasPorDia ?? null,
    ausencias: (estado.ausencias[id] ?? []).map((a) => ({ ...a })),
  }));
}

export const repo = { obtenerPerfil, listarAusencias, guardarTodo, listarMiembros };