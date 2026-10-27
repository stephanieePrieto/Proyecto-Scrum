// BASE (no modificar sin avisar al equipo) - HU-47: funcion emitirAProyecto que usan los services para avisar cambios
let ioInstancia = null;

export const registrarIO = (io) => {
    ioInstancia = io;
};

export const emitirAProyecto = (proyectoId, evento, datos) => {
    if (ioInstancia) {
        ioInstancia.to(`proyecto_${proyectoId}`).emit(evento, datos);
    }
};

/**
 * Envía un evento a todas las conexiones abiertas de una persona, estén o no en la sala del proyecto.
 * @param {number} usuarioId - Persona que recibe el evento.
 * @param {string} evento - Nombre del evento.
 * @param {Object} datos - Contenido del evento.
 */
export const emitirAUsuario = (usuarioId, evento, datos) => {
    if (ioInstancia) {
        ioInstancia.to(`usuario_${usuarioId}`).emit(evento, datos);
    }
};

/**
 * Saca a una persona de la sala de un proyecto para que deje de recibir sus eventos.
 * @param {number} usuarioId - Persona que sale de la sala.
 * @param {number} proyectoId - Proyecto cuya sala se abandona.
 */
export const retirarDeProyecto = (usuarioId, proyectoId) => {
    if (ioInstancia) {
        ioInstancia.in(`usuario_${usuarioId}`).socketsLeave(`proyecto_${proyectoId}`);
    }
};

export default {
    registrarIO,
    emitirAProyecto,
    emitirAUsuario,
    retirarDeProyecto
};