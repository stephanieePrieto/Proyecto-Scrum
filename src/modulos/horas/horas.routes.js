// Responsable: Alfonso - HU-27: endpoints de registro de horas reales
/**
 * @file horas.routes.js
 * @description Rutas de la HU-27, montadas en /api/horas (app.js carga la carpeta del módulo).
 *              Todas exigen sesión; cada persona solo ve y modifica sus propias horas.
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import * as controlador from './horas.controller.js';

const router = Router();

router.use(autenticar);

// Hoja semanal "Mis horas"
router.get('/semana', controlador.obtenerSemana);

// Temporizador (antes de /:id para que "temporizador" no se tome como identificador)
router.get('/temporizador', controlador.obtenerTemporizador);
router.post('/temporizador/iniciar', controlador.iniciarTemporizador);
router.post('/temporizador/pausar', controlador.pausarTemporizador);
router.post('/temporizador/reanudar', controlador.reanudarTemporizador);
router.post('/temporizador/detener', controlador.detenerTemporizador);
router.delete('/temporizador', controlador.descartarTemporizador);

// Registros de horas
router.post('/', controlador.registrar);
router.patch('/:id', controlador.actualizar);
router.delete('/:id', controlador.eliminar);

export default router;