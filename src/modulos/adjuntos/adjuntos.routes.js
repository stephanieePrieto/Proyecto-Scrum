// Responsable: Alfonso - HU-20: rutas de adjuntos (se montan en /api/adjuntos)
/**
 * @file adjuntos.routes.js
 * @description Subida con multer (disco, 1 archivo, maximo 10 MB). El orden de los middlewares es:
 *              identificar -> permiso por proyecto -> multer -> controlador, para no recibir archivos de quien no tiene acceso.
 */
import { Router } from 'express';
import multer from 'multer';
import { identificar } from '../../middlewares/identificar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { leerId } from '../detalle-tarjeta/detalle-tarjeta.service.js';
import {
  CARPETA_ADJUNTOS,
  LIMITE_BYTES,
  esExtensionBloqueada,
  limpiarNombre,
  nombreGuardado,
} from './adjuntos.service.js';
import * as controlador from './adjuntos.controller.js';

const router = Router();

const subirArchivo = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CARPETA_ADJUNTOS),
    filename: (req, file, cb) => cb(null, nombreGuardado(file.originalname)),
  }),
  limits: { fileSize: LIMITE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (esExtensionBloqueada(limpiarNombre(file.originalname))) {
      cb(new ErrorApp('Este tipo de archivo no está permitido (por ejemplo, ejecutables).', 415));
      return;
    }
    cb(null, true);
  },
}).single('archivo');

/**
 * Ejecuta multer y traduce sus errores a mensajes claros en español.
 * @param {import('express').Request} req Peticion.
 * @param {import('express').Response} res Respuesta.
 * @param {import('express').NextFunction} next Siguiente middleware.
 */
function recibirArchivo(req, res, next) {
  subirArchivo(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(new ErrorApp('El archivo supera el límite de 10 MB. Elige uno más pequeño.', 413));
      }
      if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.code === 'LIMIT_FILE_COUNT') {
        return next(new ErrorApp('Envía un solo archivo por vez.', 400));
      }
      return next(new ErrorApp('No se pudo procesar el archivo.', 400));
    }
    return next(error);
  });
}

/** Resuelve el proyecto a partir de la tarjeta (:tareaId). */
const permisoTarea = (clave) => requierePermiso(clave, { recurso: 'tareas', parametroRecurso: 'tareaId' });

/** Resuelve el proyecto a partir del adjunto (:id). */
const permisoAdjunto = (clave) => requierePermiso(clave, {
  resolverProyecto: async (req) => {
    const id = leerId(req.params.id);
    if (id === null) throw new ErrorApp('El identificador del adjunto no es válido.', 400);
    const { rows } = await consulta(
      'SELECT t.proyecto_id FROM adjuntos a JOIN tareas t ON t.id = a.tarea_id WHERE a.id = $1',
      [id],
    );
    if (rows.length === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
    return rows[0].proyecto_id;
  },
});

router.use(identificar);

router.get('/tarea/:tareaId', permisoTarea('proyecto.ver'), controlador.listar);
router.post('/tarea/:tareaId', permisoTarea('tarea.gestionar'), recibirArchivo, controlador.subir);
router.get('/:id/descargar', permisoAdjunto('proyecto.ver'), controlador.descargar);
router.delete('/:id', permisoAdjunto('tarea.gestionar'), controlador.eliminar);

export default router;