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

export default {
    registrarIO,
    emitirAProyecto
};