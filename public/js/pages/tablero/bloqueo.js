// Responsable: Camila - HU-23: bloquear tarjeta y vincular impedimento
/**
 * Valida que el desarrollador proporcione un motivo al bloquear una tarjeta.
 * @param {string} motivo - Texto explicativo del bloqueo.
 * @returns {boolean} Retorna true si el motivo tiene contenido válido.
 */
export const validarMotivoBloqueo = (motivo) => {
    return typeof motivo === 'string' && motivo.trim().length > 0;
};

/**
 * Verifica si es seguro mover una tarjeta a una columna de destino.
 * @param {boolean} estaBloqueada - Estado de bloqueo actual de la tarjeta.
 * @param {boolean} esColumnaFinal - Indica si la columna destino representa "Hecho".
 * @returns {Object} { permitido: boolean, mensaje: string|null }
 */
export const evaluarMovimientoBloqueo = (estaBloqueada, esColumnaFinal) => {
    if (estaBloqueada && esColumnaFinal) {
        return {
            permitido: false,
            mensaje: "No puedes mover una tarjeta bloqueada a la columna de Hecho."
        };
    }
    return { permitido: true, mensaje: null };
};

/**
 * Determina si la interfaz debe sugerir el desbloqueo automático de una tarjeta.
 * @param {boolean} tarjetaBloqueada - Estado de la tarjeta.
 * @param {string} estadoImpedimento - Estado del impedimento ('abierto' o 'resuelto').
 * @returns {boolean} Retorna true si el impedimento se resolvió pero la tarjeta sigue bloqueada.
 */
export const debeSugerirDesbloqueo = (tarjetaBloqueada, estadoImpedimento) => {
    return tarjetaBloqueada && estadoImpedimento === 'resuelto';
};