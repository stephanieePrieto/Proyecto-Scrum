// Responsable: Camila - HU-17, HU-22: recibe la peticion y responde (columnas configurables y limites WIP); sin logica de negocio
import asyncHandler from '../../utils/asyncHandler.js';
import * as tableroService from './tablero.service.js';

export const obtenerTablero = asyncHandler(async (req, res) => {
    const { proyectoId } = req.params;
    
    // Llama al servicio que contiene la lógica de SQL
    const tablero = await tableroService.obtenerDatosTablero(proyectoId);
    
    res.json({ exito: true, datos: tablero });
});

export const configurarColumnas = asyncHandler(async (req, res) => {
    const { proyectoId } = req.params;
    const { columnas } = req.body;

    // Validación básica
    if(!columnas || !Array.isArray(columnas)) {
        return res.status(400).json({ error: "Datos de columnas no válidos" });
    }

    await tableroService.actualizarColumnas(proyectoId, columnas);
    
    res.json({ exito: true, mensaje: "Columnas actualizadas correctamente." });
});