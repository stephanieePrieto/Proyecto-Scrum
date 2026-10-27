import { env } from '../config/env.js';
// BASE (no modificar sin avisar al equipo) - HU-47: inicia Socket.io, autentica conexiones y maneja las salas por proyecto

/**
 * @file index.js
 * @description Servidor de Socket.io: autentica las conexiones con el token de sesión y administra
 * las salas por proyecto y por persona.
 * @author Citlaly Morales Viveros
 */
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { consulta } from '../config/db.js';
import { registrarIO } from './emisor.js';
import { sesionVigente, sesionesVigentes } from '../modulos/auth/auth.service.js';

let io = null;

const INTERVALO_REVISION_MS = 30 * 1000;

/**
 * Obtiene el token de sesión de la conexión: primero la cookie httpOnly accessToken y, si no
 * existe, el campo auth.token enviado por el cliente de Socket.io.
 * @param {import('socket.io').Socket} socket
 * @returns {string|undefined}
 */
function extraerToken(socket) {
  const cookieHeader = socket.handshake.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, current) => {
      const [key, value] = current.trim().split('=');
      acc[key] = value;
      return acc;
    }, {});
    if (cookies.accessToken) return cookies.accessToken;
  }
  return socket.handshake.auth?.token;
}

/**
 * Indica si la persona puede seguir un proyecto: administrador global o integrante del proyecto.
 * Se consulta la base en cada petición para que un rol retirado deje de dar acceso de inmediato.
 * @param {number} usuarioId
 * @param {number} proyectoId
 * @returns {Promise<boolean>}
 */
async function puedeSeguirProyecto(usuarioId, proyectoId) {
  const { rows } = await consulta(
    `SELECT 1 FROM miembros_proyecto m JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.proyecto_id = $1 AND m.usuario_id = $2 AND u.activo = TRUE`,
    [proyectoId, usuarioId],
  );
  return rows.length > 0;
}

/**
 * Inicializa el servidor WebSocket de Socket.io sobre el servidor HTTP.
 * @param {import('http').Server} servidorServidorHttp 
 */
export function iniciarSockets(servidorServidorHttp) {
  io = new Server(servidorServidorHttp, {
    cors: {
      origin: new URL(env.APP_URL).origin,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      credentials: true,
    },
  });

  registrarIO(io);

  // Rechaza las conexiones sin sesión válida y guarda quién se conecta
  io.use(async (socket, next) => {
    try {
      const token = extraerToken(socket);
      if (!token) return next(new Error('No has iniciado sesión.'));

      const { rows } = await consulta('SELECT 1 FROM tokens_revocados WHERE token = $1', [token]);
      if (rows.length) return next(new Error('Sesión finalizada o token inválido.'));

      const decodificado = jwt.verify(token, env.JWT_SECRET);

      // Conectarse no es actividad: solo se comprueba que la sesión siga vigente
      if (!decodificado.sid || !(await sesionVigente(decodificado.sid))) {
        return next(new Error('Sesión cerrada o inactiva.'));
      }

      socket.data.usuarioId = decodificado.id;
      socket.data.sesionId = decodificado.sid;
      next();
    } catch (error) {
      next(new Error('Token inválido o expirado.'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Cliente conectado a Socket.io: ${socket.id}`);

    // Sala personal: permite avisar a una persona sin importar en qué proyecto esté
    socket.join(`usuario_${socket.data.usuarioId}`);

    // Sala de la sesión: permite desconectar todas las conexiones de una sesión que terminó
    socket.join(`sesion_${socket.data.sesionId}`);

    socket.on('unirse_proyecto', async (proyectoId, respuesta) => {
      const id = Number(proyectoId);
      const permitido = Number.isInteger(id) && id > 0 && (await puedeSeguirProyecto(socket.data.usuarioId, id).catch(() => false));
      if (permitido) socket.join(`proyecto_${id}`);
      if (typeof respuesta === 'function') respuesta({ ok: permitido });
    });

    socket.on('salir_proyecto', (proyectoId) => {
      socket.leave(`proyecto_${Number(proyectoId)}`);
    });

    socket.on('disconnect', () => {
      console.log(`Cliente desconectado: ${socket.id}`);
    });
  });

  // Desconecta las conexiones cuya sesión se cerró o venció, aunque la persona no haga ninguna petición
  setInterval(() => {
    revisarSesiones().catch((error) => console.error(`[Sockets] No se pudieron revisar las sesiones: ${error.message}`));
  }, INTERVALO_REVISION_MS).unref();

  return io;
}

/**
 * Revisa las sesiones de todas las conexiones abiertas y desconecta las que ya no están vigentes.
 * No modifica la actividad de ninguna sesión.
 * @returns {Promise<void>}
 */
async function revisarSesiones() {
  if (!io) return;

  const conexiones = await io.fetchSockets();
  const sesiones = [...new Set(conexiones.map((conexion) => conexion.data.sesionId).filter(Boolean))];
  if (sesiones.length === 0) return;

  const vigentes = await sesionesVigentes(sesiones);
  sesiones.filter((sid) => !vigentes.has(sid)).forEach((sid) => cerrarSocketsDeSesion(sid));
}

/**
 * Obtiene la instancia activa de Socket.io para emitir eventos desde los controladores.
 * @returns {Server|null}
 */
export function obtenerIO() {
  return io;
}

/**
 * Avisa y desconecta todas las conexiones en tiempo real de una sesión.
 * @param {string} sesionId - Identificador de la sesión (sid).
 * @returns {void}
 */
export function cerrarSocketsDeSesion(sesionId) {
  if (!io) return;
  io.to(`sesion_${sesionId}`).emit('sesion:cerrada');
  io.in(`sesion_${sesionId}`).disconnectSockets(true);
}