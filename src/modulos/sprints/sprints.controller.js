// Responsable: Jetz - HU-06, HU-07: recibe la peticion y responde (crear y planificar sprints); sin logica de negocio

import { obtenerCapacidadEquipo } from '../capacidad/capacidad.service.js';

import {
  obtenerSprintsProyecto,
  validarDatosSprint,
  esScrumMaster,
  obtenerEquipoProyecto,
  obtenerFechasProyecto,
  verificarSolapamiento,
  crearSprintSeguro,
  perteneceAlProyecto
} from './sprints.service.js';

 // Consultar los sprints existentes de un proyecto
export async function listarSprints(req, res) {
  try {
    // Obtener el ID del proyecto desde la URL
    const proyectoId = Number(req.params.proyectoId);

    // Comprobar que el ID sea válido
    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
      return res.status(400).json({
        mensaje: 'El ID del proyecto no es válido'
      });
    }

    // Identificar al usuario que inició sesión
    const usuarioId = Number(req.user.id);

    // Verificar que pertenezca al proyecto
    const tieneAcceso = await perteneceAlProyecto(proyectoId, usuarioId);

    if (!tieneAcceso) {
    return res.status(403).json({
        mensaje: 'No tienes permiso para consultar los sprints de este proyecto'
    });
    }

    // Consultar los sprints únicamente si tiene permiso
    const sprints = await obtenerSprintsProyecto(proyectoId);

    return res.status(200).json({ sprints });

  } catch (error) {
    console.error('Error al consultar sprints:', error);

    return res.status(500).json({
      mensaje: 'No se pudieron consultar los sprints'
    });
  }
}


// Crear un nuevo sprint
export async function crearSprint(req, res) {
  try {
    const datos = req.body;
    const usuarioId = Number(req.user.id);
    const proyectoId = Number(datos?.proyectoId);

    // 1. Validar el ID del proyecto
    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
      return res.status(400).json({
        mensaje: 'El ID del proyecto no es válido'
      });
    }
    
    // 2. Obtener el equipo del proyecto desde la base de datos
    const equipoId = await obtenerEquipoProyecto(proyectoId);

    if (equipoId === null) {
    return res.status(404).json({
        mensaje: 'El proyecto no existe'
    });
    }

    // 3. Verificar que sea Scrum Master del proyecto
    const tienePermiso = await esScrumMaster(proyectoId, usuarioId);

    if (!tienePermiso) {
      return res.status(403).json({
        mensaje: 'No tienes permiso para crear sprints en este proyecto'
      });
    }

    // 4. Validar los datos del formulario
    const errorValidacion = validarDatosSprint(datos);

    if (errorValidacion) {
      return res.status(400).json({
        mensaje: errorValidacion
      });
    }
    

    // Comprobar que el sprint esté dentro del periodo del proyecto
    const fechasProyecto = await obtenerFechasProyecto(proyectoId);

    if (!fechasProyecto) {
      return res.status(404).json({
        mensaje: 'El proyecto no existe'
      });
    }

    // El sprint no puede comenzar antes que el proyecto
    if (datos.fechaInicio < fechasProyecto.fecha_inicio) {
      return res.status(400).json({
        mensaje: `El sprint no puede comenzar antes del ${fechasProyecto.fecha_inicio}`
      });
    }

    // El sprint no puede terminar después que el proyecto
    if (datos.fechaFin > fechasProyecto.fecha_fin) {
      return res.status(400).json({
        mensaje: `El sprint no puede terminar después del ${fechasProyecto.fecha_fin}`
      });
    }


    // 5. Comprobar que no existan sprints con fechas superpuestas
    const existeSolapamiento = await verificarSolapamiento(
    equipoId,
    datos.fechaInicio,
    datos.fechaFin
    );

    if (existeSolapamiento) {
    return res.status(409).json({
        mensaje: 'Ya existe un sprint de este equipo que coincide con las fechas seleccionadas'
    });
    }
    
    // 6. Calcular la capacidad real del equipo
    const capacidad = await obtenerCapacidadEquipo(equipoId, {
    inicio: datos.fechaInicio,
    fin: datos.fechaFin
    });

    // Obtener las horas calculadas por el servidor
    const capacidadHoras = Number(capacidad.totalHoras);

    // Comprobar que exista capacidad disponible
    if (!Number.isFinite(capacidadHoras) || capacidadHoras <= 0) {
    return res.status(400).json({
        mensaje: 'El equipo no tiene capacidad disponible para estas fechas'
    });
    }


    
    // 7. Guardar el sprint con la capacidad calculada
    const resultado = await crearSprintSeguro(
      {
        proyectoId,
        nombre: datos.nombre,
        objetivo: datos.objetivo,
        fechaInicio: datos.fechaInicio,
        fechaFin: datos.fechaFin,
        capacidadHoras
      },
      equipoId,
      usuarioId
    );

    if (resultado.permisoDenegado) {
    return res.status(403).json({
        mensaje: 'Ya no tienes permiso para crear sprints en este proyecto'
    });
    }

    // Comprobar si el proyecto cambió durante la operación
    if (resultado.proyectoInvalido) {
    return res.status(409).json({
        mensaje: 'El proyecto cambió durante la creación. Inténtalo nuevamente.'
    });
    }

    
    // Comprobar si las fechas quedaron fuera del periodo del proyecto
    if (resultado.fechasInvalidas) {
      return res.status(409).json({
        mensaje: 'Las fechas del sprint están fuera del periodo del proyecto. Revisa las fechas e inténtalo nuevamente.'
      });
    }


    // Comprobar si apareció un conflicto de fechas
    if (resultado.conflicto) {
      return res.status(409).json({
        mensaje: 'Ya existe un sprint de este equipo que coincide con las fechas seleccionadas'
      });
    }

    // Confirmar que el sprint fue creado
    return res.status(201).json({
      mensaje: 'Sprint creado correctamente',
      sprint: resultado.sprint
    });


  } catch (error) {
    console.error('Error al crear sprint:', error);

    return res.status(500).json({
      mensaje: 'No se pudo crear el sprint'
    });
  }
}
