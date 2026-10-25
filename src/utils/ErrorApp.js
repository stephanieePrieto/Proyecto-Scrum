// BASE (no modificar sin avisar al equipo) - HU-47: error con codigo HTTP (403, 404, 409...)

export class ErrorApp extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

export default ErrorApp;