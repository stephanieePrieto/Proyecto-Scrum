/**
 * @file paneles-rol.js
 * @description Panel del tablero según el rol de la persona en el proyecto abierto (HU-65).
 * El rol es por proyecto: la misma persona puede ser Scrum Master en un proyecto
 * y Developer en otro, por eso el panel se decide al elegir el proyecto, no al iniciar sesión.
 * Módulo puro (sin DOM) para poder probarlo en Node sin navegador.
 *
 * @author Citlaly Morales Viveros
 */

/** KPIs que existen en el tablero (los devuelve GET /api/metricas/proyectos/:id/dashboard). */
export const KPIS_PANEL = ['avance', 'diasRestantes', 'impedimentos', 'desviacion'];

/**
 * Configuración del panel por rol: título, subtítulo, qué KPIs se muestran y de dónde
 * salen los impedimentos ('todos' = los del proyecto, 'mios' = solo los de la persona).
 * Los KPIs son los que ya devuelve el servidor; ningún panel pide datos nuevos.
 */
const PANELES = {
    scrum_master: {
        titulo: 'Panel del Scrum Master',
        subtitulo: 'Salud del sprint y del equipo',
        kpis: ['avance', 'diasRestantes', 'impedimentos', 'desviacion'],
        impedimentos: 'todos',
        etiquetaImpedimentos: 'Impedimentos abiertos',
    },
    product_owner: {
        titulo: 'Panel del Product Owner',
        subtitulo: 'Backlog, valor y avance del producto',
        kpis: ['avance', 'diasRestantes', 'desviacion'],
        impedimentos: 'todos',
        etiquetaImpedimentos: 'Impedimentos abiertos',
    },
    developer: {
        titulo: 'Panel del Developer',
        subtitulo: 'Tu trabajo en este proyecto',
        kpis: ['avance', 'impedimentos', 'diasRestantes'],
        impedimentos: 'mios',
        etiquetaImpedimentos: 'Mis impedimentos abiertos',
    },
};

/** Panel genérico para quien no tiene rol en el proyecto (o aún no se conoce el rol). */
export const PANEL_GENERICO = {
    titulo: 'Dashboard del proyecto',
    subtitulo: 'Estado general de un vistazo',
    kpis: [...KPIS_PANEL],
    impedimentos: 'todos',
    etiquetaImpedimentos: 'Impedimentos abiertos',
};

/**
 * Devolver la configuración del panel para un rol.
 * Un rol desconocido o sin rol devuelve el panel genérico (el tablero de siempre).
 *
 * @param {string|null} rol - 'scrum_master', 'product_owner', 'developer' o null.
 * @returns {Object} Configuración del panel.
 */
export function panelParaRol(rol) {
    return PANELES[rol] || PANEL_GENERICO;
}
