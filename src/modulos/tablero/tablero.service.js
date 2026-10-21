// Responsable: Camila - HU-17, HU-22: reglas, SQL y avisos por socket (columnas configurables y limites WIP)
import { query } from '../../config/db.js';
import ErrorApp from '../../utils/ErrorApp.js';
import { emitirAProyecto } from '../../sockets/emisor.js'; // Base HU-47

export const obtenerDatosTablero = async (proyectoId) => {
    //Buscar sprint activo
    const sprintRes = await query(`SELECT id, nombre, objetivo, fecha_fin FROM sprints WHERE proyecto_id = $1 AND estado = 'Activo'`, [proyectoId]);
    if (sprintRes.rows.length === 0) return null; // No hay sprint activo

    const sprint = sprintRes.rows[0];

    // Traer columnas del proyecto
    const colRes = await query(`SELECT id, nombre, limite_wip, orden FROM columnas WHERE proyecto_id = $1 ORDER BY orden ASC`, [proyectoId]);

    // Traer tareas del sprint activo (Simulado con un JOIN para datos del responsable)
    const tareasRes = await query(`
        SELECT t.*, u.nombre as responsable_nombre, u.foto as responsable_foto, u.activo as responsable_activo 
        FROM tareas t 
        LEFT JOIN usuarios u ON t.responsable_id = u.id 
        WHERE t.sprint_id = $1
    `, [sprint.id]);

    return {
        sprint: sprint,
        columnas: colRes.rows,
        tareas: tareasRes.rows
    };
};

export const actualizarColumnas = async (proyectoId, columnasNuevas) => {
    // Iniciar transacción SQL para actualizar las columnas
    await query('BEGIN');
    try {
        for (const col of columnasNuevas) {            
            if (!col.nombre || col.nombre.trim() === '') {
                throw new ErrorApp(400, "El nombre de la columna no puede estar vacío.");
            }            
            await query(`UPDATE columnas SET nombre = $1 WHERE id = $2 AND proyecto_id = $3`, [col.nombre.trim(), col.id, proyectoId]);
        }
        await query('COMMIT');

        // Avisar en tiempo real a los conectados
        emitirAProyecto(proyectoId, 'tablero:columnas_actualizadas', columnasNuevas);

    } catch (error) {
        await query('ROLLBACK');
        throw error;
    }
};