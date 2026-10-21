// BASE (no modificar sin avisar al equipo) - HU-47: inicia Socket.io, autentica conexiones y maneja las salas por proyecto
import { Server } from 'socket.io';

let io = null;

/**
 * Inicializa el servidor WebSocket de Socket.io sobre el servidor HTTP.
 * @param {import('http').Server} servidorServidorHttp 
 */
export function iniciarSockets(servidorServidorHttp) {
  io = new Server(servidorServidorHttp, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`Cliente conectado a Socket.io: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`Cliente desconectado: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Obtiene la instancia activa de Socket.io para emitir eventos desde los controladores.
 * @returns {Server|null}
 */
export function obtenerIO() {
  return io;
}