// BASE (no modificar sin avisar al equipo) - HU-42: revisa membresia y rol por proyecto (lo escribe Citlaly)

/**
 * @file requiereRol.js
 * @description Middleware de autorización por rol dentro del proyecto. Se coloca después de autenticar
 * y comprueba la matriz de permisos de permisos.js con el rol vigente en la base de datos, de modo que
 * un cambio de rol se aplica en la siguiente petición sin cerrar sesión.
 * @author Citlaly Morales Viveros
 */
import { consulta } from '../config/db.js';
import { ErrorApp } from '../utils/ErrorApp.js';
import { PERMISOS, MENSAJE_NO_ENCONTRADO, exigirPermiso } from '../utils/permisos.js';

/** Tablas que guardan su proyecto en la columna proyecto_id; se usa como lista permitida al resolver el proyecto. */
const TABLAS_CON_PROYECTO = new Set(['epicas', 'sprints', 'historias', 'columnas_tablero', 'tareas', 'impedimentos']);

/** Valor máximo de una columna INTEGER de PostgreSQL. */
const ENTERO_MAXIMO = 2147483647;

/**
 * Convierte un valor recibido en la petición a un identificador entero positivo.
 *
 * @param {*} valor - Valor a convertir.
 * @returns {number|null} El identificador, o null si no es un entero positivo válido.
 */
function leerIdentificador(valor) {
    if (typeof valor !== 'string' && typeof valor !== 'number') return null;
    if (typeof valor === 'string' && !/^\d+$/.test(valor.trim())) return null;
    const numero = Number(valor);
    return Number.isInteger(numero) && numero > 0 && numero <= ENTERO_MAXIMO ? numero : null;
}

/**
 * Crea un middleware que exige un permiso de la matriz sobre el proyecto de la petición.
 * Por omisión toma el proyecto de req.params.proyectoId; si la ruta solo trae el identificador de un
 * recurso (por ejemplo /historias/:id), se indica la tabla en "recurso" y el proyecto se obtiene del registro.
 * Al terminar deja el rol vigente en req.rolProyecto y el proyecto en req.proyectoId.
 *
 * @param {string} clave - Clave del permiso, definida en PERMISOS (por ejemplo 'historia.gestionar').
 * @param {Object} [opciones] - Cómo localizar el proyecto de la petición.
 * @param {string} [opciones.parametro='proyectoId'] - Parámetro de la ruta que contiene el identificador del proyecto.
 * @param {string} [opciones.recurso] - Tabla del recurso (epicas, sprints, historias, columnas_tablero, tareas o impedimentos).
 * @param {string} [opciones.parametroRecurso='id'] - Parámetro de la ruta con el identificador del recurso.
 * @param {function(import('express').Request): (number|string|Promise<number|string>)} [opciones.resolverProyecto] -
 * Función propia para obtener el identificador del proyecto cuando los casos anteriores no aplican.
 * @returns {import('express').RequestHandler}
 * @throws {Error} Al crearlo, si la clave o la tabla indicadas no existen.
 */
export function requierePermiso(clave, opciones = {}) {
    if (!PERMISOS[clave]) {
        throw new Error(`requierePermiso: la clave "${clave}" no existe en la matriz de permisos.`);
    }
    const { parametro = 'proyectoId', recurso, parametroRecurso = 'id', resolverProyecto } = opciones;
    if (recurso && !TABLAS_CON_PROYECTO.has(recurso)) {
        throw new Error(`requierePermiso: la tabla "${recurso}" no está permitida como recurso.`);
    }

    return async (req, res, next) => {
        try {
            if (!req.user?.id) throw new ErrorApp('No has iniciado sesión.', 401);

            let proyectoId;
            if (resolverProyecto) {
                proyectoId = leerIdentificador(await resolverProyecto(req));
            } else if (recurso) {
                const recursoId = leerIdentificador(req.params[parametroRecurso]);
                if (recursoId === null) throw new ErrorApp('El identificador solicitado no es válido.', 400);
                const { rows } = await consulta(`SELECT proyecto_id FROM ${recurso} WHERE id = $1`, [recursoId]);
                if (rows.length === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
                proyectoId = rows[0].proyecto_id;
            } else {
                proyectoId = leerIdentificador(req.params[parametro]);
            }
            if (proyectoId === null) throw new ErrorApp('El identificador del proyecto no es válido.', 400);

            req.rolProyecto = await exigirPermiso(req.user, clave, proyectoId);
            req.proyectoId = proyectoId;
            next();
        } catch (error) {
            next(error);
        }
    };
}

export default requierePermiso;