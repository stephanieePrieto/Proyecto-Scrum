// Responsable: Camila - HU-22: limite WIP por columna
/**
 * Formatea el texto del contador de tarjetas para el encabezado de la columna.
 * @param {number} totalTarjetas - Cantidad de tarjetas actualmente en la columna.
 * @param {number|null} limiteWip - Límite máximo configurado (null si no tiene límite).
 * @returns {string} Texto formateado (ej. "3/4" o "3").
 */
export const formatearContadorWIP = (totalTarjetas, limiteWip) => {
    return limiteWip ? `${totalTarjetas}/${limiteWip}` : `${totalTarjetas}`;
};

/**
 * Evalúa el estado del límite WIP al intentar soltar una tarjeta en la columna.
 * @param {number} totalTarjetas - Cantidad de tarjetas en la columna ANTES del movimiento.
 * @param {number|null} limiteWip - Límite configurado para la columna.
 * @param {boolean} esDuro - Indica si la restricción de la columna es un límite duro.
 * @returns {Object} { permitido: boolean, alertaBlanda: boolean }
 */
export const evaluarEstadoWIP = (totalTarjetas, limiteWip, esDuro) => {
    if (!limiteWip) return { permitido: true, alertaBlanda: false };
    
    const excedeLimite = (totalTarjetas + 1) > limiteWip;
    
    if (excedeLimite && esDuro) {
        return { permitido: false, alertaBlanda: false };
    }
    
    if (excedeLimite && !esDuro) {
        return { permitido: true, alertaBlanda: true };
    }
    
    return { permitido: true, alertaBlanda: false };
};

/**
 * Valida la entrada del formulario de configuración de columnas.
 * @param {number} valor - Límite WIP ingresado por el usuario.
 * @returns {boolean} Retorna true si es un número entero positivo.
 */
export const validarInputLimite = (valor) => {
    return Number.isInteger(valor) && valor > 0;
};