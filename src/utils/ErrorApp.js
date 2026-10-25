// BASE (no modificar sin avisar al equipo) - HU-47: error con codigo HTTP (403, 404, 409...)

/**
 * @file ErrorApp.js
 * @description Clase personalizada para el manejo de errores HTTP operacionales.
 * @author Citlaly Morales Viveros
 */
export class ErrorApp extends Error {
    /**
     * @param {string} mensaje - Descripción del error.
     * @param {number} statusCode - Código de estado HTTP.
     */
    constructor(mensaje, statusCode) {
        super(mensaje);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

export default {};