// Responsable: Jetz - HU-07, HU-08: logica de la pantalla de planificacion con medidor de capacidad y tareas (llama a la API y escucha sockets)

/**
 * 
 * HU-08: Planificación del Sprint
 * Navegación entre proyectos.
 */

import { montarBarraSuperior } from '../core/layout.js';
import { api } from '../core/api.js';

// Barra superior compartida de AgileDesk
montarBarraSuperior();

// ==========================================
// Proyecto seleccionado
// ==========================================

const parametros = new URLSearchParams(window.location.search);

let proyectoId =
  parametros.get('proyecto') ||
  localStorage.getItem('proyectoActivo');

const contenedorPestanas =
  document.getElementById('pestanas-proyectos');

const enlaceVolver =
  document.getElementById('enlace-volver-sprints');

// Evitar cambios simultáneos
let cambiandoProyecto = false;

// ==========================================
// Actualizar el enlace de regreso
// ==========================================

function actualizarEnlaceSprints() {
  const url = new URL('/pages/sprints.html', window.location.origin);

  if (proyectoId) {
    url.searchParams.set('proyecto', proyectoId);
  }

  enlaceVolver.href = url.pathname + url.search;
}

// ==========================================
// Seleccionar proyecto
// ==========================================

function marcarProyectoActivo() {
  const pestanas = contenedorPestanas.querySelectorAll(
    '.sprints-proyectos__pestana'
  );

  pestanas.forEach((pestana) => {
    const activa =
      pestana.dataset.proyectoId === String(proyectoId);

    pestana.classList.toggle(
      'sprints-proyectos__pestana--activa',
      activa
    );

    if (activa) {
      pestana.setAttribute('aria-current', 'page');
    } else {
      pestana.removeAttribute('aria-current');
    }
  });
}

// ==========================================
// Cambiar proyecto sin recargar
// ==========================================

async function cambiarProyecto(nuevoId, guardarHistorial = true) {
  if (cambiandoProyecto) return;
  if (String(nuevoId) === String(proyectoId)) return;

  cambiandoProyecto = true;

  // Invalidar consultas del proyecto anterior.
    versionConsultaSprint++;

  try {
    proyectoId = String(nuevoId);

    localStorage.setItem('proyectoActivo', proyectoId);

    if (guardarHistorial) {
      const url = new URL(window.location.href);
      url.searchParams.set('proyecto', proyectoId);

      window.history.pushState({}, '', url);
    }

    marcarProyectoActivo();
    actualizarEnlaceSprints();

    // Evitar mostrar datos del proyecto anterior.
    document.getElementById('selector-sprint').innerHTML =
      '<option value="">Selecciona un Sprint</option>';

    document.getElementById('total-historias').textContent = '0';
    document.getElementById('total-tareas').textContent = '0';
    document.getElementById('total-horas').textContent = '0 h';


    const listaHistorias =
    document.getElementById('lista-historias-sprint');

    // Limpiar las historias del proyecto anterior
    listaHistorias.replaceChildren();

    // Crear el mensaje dentro de una tarjeta
    const tarjetaVacia = document.createElement('div');
    tarjetaVacia.className = 'tarjeta planificacion-vacio';

    const mensajeVacio = document.createElement('p');
    mensajeVacio.textContent =
    'Selecciona un Sprint para consultar sus historias de usuario.';

    tarjetaVacia.appendChild(mensajeVacio);
    listaHistorias.appendChild(tarjetaVacia);


    document.getElementById('mensaje-planificacion').hidden = true;

    await cargarSprintsProyecto();

  } finally {
    cambiandoProyecto = false;
  }
}

// ==========================================
// Consultar y mostrar proyectos
// ==========================================

async function cargarPestanasProyectos() {
  contenedorPestanas.textContent = 'Cargando proyectos...';

  try {
    const datos = await api('/proyectos');
    const proyectos = datos.proyectos || [];

    contenedorPestanas.replaceChildren();

    if (proyectos.length === 0) {
      contenedorPestanas.textContent =
        'No hay proyectos disponibles.';
      return;
    }

    // Seleccionar el primero si no existe uno activo
    const proyectoValido = proyectos.some(
      (proyecto) => String(proyecto.id) === String(proyectoId)
    );

    if (!proyectoValido) {
      proyectoId = String(proyectos[0].id);
      localStorage.setItem('proyectoActivo', proyectoId);

      const url = new URL(window.location.href);
      url.searchParams.set('proyecto', proyectoId);
      window.history.replaceState({}, '', url);
    }

    proyectos.forEach((proyecto) => {
      const pestana = document.createElement('button');

      pestana.type = 'button';
      pestana.className = 'sprints-proyectos__pestana';
      pestana.dataset.proyectoId = String(proyecto.id);
      pestana.textContent = proyecto.nombre;

      pestana.addEventListener('click', () => {
        cambiarProyecto(proyecto.id);
      });

      contenedorPestanas.appendChild(pestana);
    });

    marcarProyectoActivo();
    actualizarEnlaceSprints();

  } catch (error) {
    console.error('Error al cargar proyectos:', error);

    contenedorPestanas.textContent =
      'No se pudieron cargar los proyectos.';
  }
}

// ==========================================
// Navegación Atrás / Adelante
// ==========================================

window.addEventListener('popstate', () => {
  const parametros = new URLSearchParams(window.location.search);

  const nuevoId =
    parametros.get('proyecto') ||
    localStorage.getItem('proyectoActivo');

  if (nuevoId) {
    cambiarProyecto(nuevoId, false);
  }
});


/**
 * HU-08: Cargar los Sprints del proyecto activo.
 */
async function cargarSprintsProyecto() {
  const selector = document.getElementById('selector-sprint');
  const proyectoConsultado = proyectoId;

  selector.replaceChildren();
  selector.add(new Option('Cargando Sprints...', ''));
  selector.disabled = true;

  if (!proyectoConsultado) {
    selector.replaceChildren();
    selector.add(new Option('Selecciona un proyecto', ''));
    return;
  }

  try {
    const datos = await api(
      `/sprints/proyectos/${proyectoConsultado}`
    );

    // Ignorar resultados de un proyecto anterior.
    if (String(proyectoConsultado) !== String(proyectoId)) {
      return;
    }

    selector.replaceChildren();
    selector.add(new Option('Selecciona un Sprint', ''));

    const sprints = datos.sprints || [];

    if (sprints.length === 0) {
      selector.replaceChildren();
      selector.add(new Option('Este proyecto no tiene Sprints', ''));
      return;
    }

    sprints.forEach((sprint) => {
      const opcion = new Option(sprint.nombre, String(sprint.id));
      selector.add(opcion);
    });

    selector.disabled = false;

  } catch (error) {
    if (String(proyectoConsultado) !== String(proyectoId)) {
      return;
    }

    console.error('Error al cargar Sprints:', error);

    selector.replaceChildren();
    selector.add(new Option('No se pudieron cargar los Sprints', ''));

    const mensaje = document.getElementById('mensaje-planificacion');
    mensaje.className = 'alerta alerta--error';
    mensaje.textContent = 'No se pudieron consultar los Sprints del proyecto.';
    mensaje.hidden = false;
  }
}


// ==========================================
// Inicialización
// ==========================================

async function iniciarPlanificacion() {
  actualizarEnlaceSprints();
  await cargarPestanasProyectos();

  if (proyectoId) {
    await cargarSprintsProyecto();
  }
}

iniciarPlanificacion();

// HU-08: Detectar el Sprint seleccionado
const selectorSprint = document.getElementById('selector-sprint');

// Identifica la consulta más reciente del Sprint.
let versionConsultaSprint = 0;

/**
 * HU-08: Consultar y mostrar las tareas técnicas
 * de una historia de usuario.
 */
async function cargarTareasHistoria(historiaId, contenedor) {
  contenedor.textContent = 'Cargando tareas técnicas...';

  try {
    const datos = await api(`/tareas/historia/${historiaId}`);
    const tareas = datos.tareas || [];

    // Limpiar el mensaje de carga.
    contenedor.replaceChildren();

    if (tareas.length === 0) {
      const mensaje = document.createElement('p');
      mensaje.className = 'subtitulo-pagina';
      mensaje.textContent =
        'Esta historia todavía no tiene tareas técnicas.';

      contenedor.appendChild(mensaje);
      return;
    }

    // Crear una tarjeta para cada tarea.
    tareas.forEach(tarea => {
      const tarjeta = document.createElement('div');
      tarjeta.className = 'tarjeta planificacion-tarea';

      const titulo = document.createElement('h4');
      titulo.textContent = tarea.titulo;

      const detalle = document.createElement('p');
      detalle.className = 'subtitulo-pagina';

      const responsable = tarea.responsable_nombre ||
        'Sin responsable';

      detalle.textContent =
        `Responsable: ${responsable} · ${tarea.horas_estimadas} h`;

      tarjeta.append(titulo, detalle);
      contenedor.appendChild(tarjeta);
    });

  } catch (error) {
    console.error('Error al cargar tareas técnicas:', error);

    contenedor.textContent =
      error.cuerpo?.mensaje ||
      'No se pudieron cargar las tareas técnicas.';
  }
}


/**
 * HU-08: Calcular el total de tareas técnicas
 * y las horas estimadas de un Sprint.
 */
async function actualizarContadoresTareas(historias, versionActual){
  const contadorTareas = document.getElementById('total-tareas');
  const contadorHoras = document.getElementById('total-horas');

  // Mostrar que los datos se están calculando.
  contadorTareas.textContent = '...';
  contadorHoras.textContent = '...';

  try {
    // Consultar las tareas de todas las historias del Sprint.
    const resultados = await Promise.all(
      historias.map(historia =>
        api(`/tareas/historia/${historia.id}`)
      )
    );

    let totalTareas = 0;
    let totalHoras = 0;

    if (versionActual !== versionConsultaSprint) return;

    // Recorrer las tareas obtenidas.
    resultados.forEach(resultado => {
      const tareas = resultado.tareas || [];

      totalTareas += tareas.length;

      tareas.forEach(tarea => {
        totalHoras += Number(tarea.horas_estimadas) || 0;
      });
    });

    // Actualizar los contadores.
    contadorTareas.textContent = totalTareas;
    contadorHoras.textContent =
      `${Math.round(totalHoras * 10) / 10} h`;


  } catch (error) {
    console.error('Error al calcular los contadores:', error);

    // Ignorar errores de consultas anteriores.
    if (versionActual !== versionConsultaSprint) return;

    // Mostrar un guion si falla la consulta.
    contadorTareas.textContent = '—';
    contadorHoras.textContent = '—';
  }
}


// HU-08: Mostrar las historias asignadas al Sprint
function mostrarHistoriasSprint(historias) {
  const contenedor = document.getElementById('lista-historias-sprint');
  const contador = document.getElementById('total-historias');

  // Limpiar las historias anteriores
  contenedor.replaceChildren();

  // Actualizar el contador
  contador.textContent = historias.length;

  // Mostrar mensaje cuando no hay historias
  if (historias.length === 0) {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'tarjeta planificacion-vacio';

    const mensaje = document.createElement('p');
    mensaje.textContent = 'Este Sprint todavía no tiene historias asignadas.';

    tarjeta.appendChild(mensaje);
    contenedor.appendChild(tarjeta);
    return;
  }

  // Crear una tarjeta por cada historia
  historias.forEach(historia => {
    const tarjeta = document.createElement('article');
    tarjeta.className = 'tarjeta planificacion-historia';

    const encabezado = document.createElement('button');
    encabezado.type = 'button';
    encabezado.className = 'planificacion-historia__encabezado';
    encabezado.setAttribute('aria-expanded', 'false');

    const informacion = document.createElement('div');

    const titulo = document.createElement('h3');
    titulo.className = 'planificacion-historia__titulo';
    titulo.textContent = `HU-${String(historia.numero_hu).padStart(2, '0')} · ${historia.titulo}`;

    const detalle = document.createElement('p');
    detalle.className = 'planificacion-historia__detalle';

    // Mostrar los puntos de la historia
    detalle.textContent = historia.puntos != null
    ? `${historia.puntos} puntos`
    : 'Sin estimar';

    // Traducir el estado para mostrarlo al usuario
    const nombresEstados = {
    backlog: 'En Backlog',
    en_sprint: 'En Sprint',
    hecho: 'Completada',
    aceptada: 'Aceptada',
    rechazada: 'Rechazada'
    };

    // Crear una insignia para el estado
    const insigniaEstado = document.createElement('span');
    insigniaEstado.className = 'planificacion-estado';
    insigniaEstado.textContent =
    nombresEstados[historia.estado] || historia.estado;

    // Agregar la insignia junto a los puntos
    detalle.append(' · ', insigniaEstado);
    
    informacion.append(titulo, detalle);

    const indicador = document.createElement('span');
    indicador.textContent = '⌄';
    indicador.setAttribute('aria-hidden', 'true');

    encabezado.append(informacion, indicador);

    // Contenido desplegable
    
    const contenido = document.createElement('div');
    contenido.className = 'planificacion-historia__contenido';
    contenido.hidden = true;


    // Contenedor donde aparecerán las tareas de la historia.
    const listaTareas = document.createElement('div');
    listaTareas.className = 'planificacion-historia__tareas';

    contenido.appendChild(listaTareas);
    
    // Botón para agregar una tarea técnica a esta historia
    const botonAgregarTarea = document.createElement('button');

    botonAgregarTarea.type = 'button';
    botonAgregarTarea.className = 'boton boton--primario';
    botonAgregarTarea.textContent = '+ Agregar tarea técnica';

    botonAgregarTarea.addEventListener('click', () => {
    // Guardar la historia a la que pertenecerá la tarea
    document.getElementById('tarea-historia-id').value = historia.id;

    // Mostrar el nombre de la historia en el formulario
    document.getElementById('historia-tarea-nombre').textContent =
        `HU-${String(historia.numero_hu).padStart(2, '0')} · ${historia.titulo}`;

    // Abrir el formulario
    document.getElementById('dialogo-tarea').showModal();

    // Cargar los responsables del equipo
    cargarResponsables();
    });


    contenido.appendChild(botonAgregarTarea);

    // Abrir y cerrar la historia.
    encabezado.addEventListener('click', async () => {
      const abierta =
        encabezado.getAttribute('aria-expanded') === 'true';

      encabezado.setAttribute('aria-expanded', String(!abierta));
      contenido.hidden = abierta;
      indicador.textContent = abierta ? '⌄' : '⌃';

      // Consultar las tareas cuando se abre la historia.
      if (!abierta) {
        await cargarTareasHistoria(historia.id, listaTareas);
      }
    });


    tarjeta.append(encabezado, contenido);
    contenedor.appendChild(tarjeta);
  });
}

selectorSprint.addEventListener('change', async () => {
  const sprintId = selectorSprint.value;
  const versionActual = ++versionConsultaSprint;
  const proyectoActual = proyectoId;

  // Si no hay un Sprint seleccionado, no consultamos historias
  if (!sprintId) {
    console.log('No hay un Sprint seleccionado');
    return;
  }

  console.log('Proyecto seleccionado:', proyectoId);
  console.log('Sprint seleccionado:', sprintId);

  // Consultar las historias del proyecto
  try {
    const datos = await api(`/backlog/proyecto/${proyectoId}`);
    
    // Ignorar respuestas de un Sprint o proyecto anterior.
    if (
      versionActual !== versionConsultaSprint ||
      String(proyectoActual) !== String(proyectoId)
    ) {
      return;
    }


    // Conservar únicamente las historias asignadas al Sprint
    const historiasSprint = (datos.historias || []).filter(
      historia => Number(historia.sprint_id) === Number(sprintId)
    );


    console.log('Historias del Sprint:', historiasSprint);

    // Mostrar las historias asignadas al Sprint.
    mostrarHistoriasSprint(historiasSprint);

    // Calcular el total de tareas y horas estimadas.
    await actualizarContadoresTareas(historiasSprint, versionActual);

  } catch (error) {
    console.error('Error al consultar las historias del Sprint:', error);
  }
});

// HU-08: Control del modal de tareas técnicas
const dialogoTarea = document.getElementById('dialogo-tarea');
const formularioTarea = document.getElementById('formulario-tarea');

// HU-08: Cargar integrantes del equipo como responsables
async function cargarResponsables() {
  const selector = document.getElementById('tarea-responsable');

  selector.replaceChildren();
  selector.add(new Option('Cargando responsables...', ''));
  selector.disabled = true;

  try {
    // Consultar el proyecto seleccionado
    const datosProyecto = await api(`/proyectos/${proyectoId}`);
    const equipoId = datosProyecto.proyecto?.equipo_id;

    if (!equipoId) {
      throw new Error('El proyecto no tiene un equipo disponible.');
    }

    // Consultar los integrantes del equipo
    const datosEquipo = await api(`/equipos/${equipoId}`);

    // Mostrar solamente integrantes activos
    const miembros = (datosEquipo.equipo?.miembros || [])
      .filter(miembro => miembro.activo);

    selector.replaceChildren();
    selector.add(new Option('Selecciona un responsable', ''));

    miembros.forEach(miembro => {
      selector.add(new Option(miembro.nombre, String(miembro.id)));
    });

    selector.disabled = miembros.length === 0;

  } catch (error) {
    console.error('Error al cargar responsables:', error);

    selector.replaceChildren();
    selector.add(new Option('No se pudieron cargar los responsables', ''));
  }
}

function cerrarModalTarea() {
  dialogoTarea.close();
}

// Cerrar con la X
document.getElementById('btn-cerrar-tarea')
  .addEventListener('click', cerrarModalTarea);

// Cerrar con Cancelar
document.getElementById('btn-cancelar-tarea')
  .addEventListener('click', cerrarModalTarea);

// Limpiar el formulario después de cerrar
dialogoTarea.addEventListener('close', () => {
  formularioTarea.reset();

  document.getElementById('tarea-historia-id').value = '';
  document.getElementById('historia-tarea-nombre').textContent = '';

  // Limpiar mensajes de validación
  document.getElementById('mensaje-formulario-tarea').hidden = true;

  document.querySelectorAll(
    '#formulario-tarea .eq-error'
  ).forEach(elemento => {
    elemento.textContent = '';
  });
});


/**
 * HU-08: Guardar una tarea técnica.
 */
formularioTarea.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const titulo = document.getElementById('tarea-titulo').value.trim();
  const responsableId = document.getElementById('tarea-responsable').value;
  const horasTexto = document.getElementById('tarea-horas').value;
  const descripcion = document.getElementById('tarea-descripcion').value.trim();
  const historiaId = document.getElementById('tarea-historia-id').value;

  const mensaje = document.getElementById('mensaje-formulario-tarea');
  const botonGuardar = document.getElementById('btn-guardar-tarea');

  // Limpiar los errores anteriores.
  mensaje.hidden = true;
  mensaje.textContent = '';

  document.querySelectorAll('#formulario-tarea .eq-error')
    .forEach(elemento => elemento.textContent = '');

  let valido = true;

  // Validar título.
  if (!titulo) {
    document.getElementById('error-tarea-titulo').textContent =
      'Escribe el título de la tarea.';
    valido = false;
  }

  // Validar responsable.
  if (!responsableId) {
    document.getElementById('error-tarea-responsable').textContent =
      'Selecciona un responsable.';
    valido = false;
  }

  // Validar horas estimadas.
  const horas = Number(horasTexto);

  if (
    !horasTexto ||
    !Number.isFinite(horas) ||
    horas <= 0 ||
    horas > 99999.9 ||
    Math.abs(horas * 10 - Math.round(horas * 10)) > 1e-8
  ) {
    document.getElementById('error-tarea-horas').textContent =
      'Ingresa horas positivas con máximo un decimal.';
    valido = false;
  }

  if (!historiaId) {
    mensaje.textContent = 'No se encontró la historia de usuario.';
    mensaje.hidden = false;
    valido = false;
  }

  if (!valido) return;

  botonGuardar.disabled = true;
  botonGuardar.textContent = 'Guardando...';

  try {
    
    await api('/tareas', {
    metodo: 'POST',
    cuerpo: {
        historia_id: Number(historiaId),
        titulo,
        descripcion,
        responsable_id: Number(responsableId),
        horas_estimadas: horas
    }

    });

    // Cerrar el formulario después de guardar.
    dialogoTarea.close();

    // Volver a consultar las historias del Sprint.
    selectorSprint.dispatchEvent(new Event('change'));

  } catch (error) {
    console.error('Error al guardar tarea técnica:', error);

    mensaje.textContent =
    error.cuerpo?.mensaje ||
    error.message ||
    'No se pudo guardar la tarea técnica.';
    mensaje.hidden = false;

  } finally {
    botonGuardar.disabled = false;
    botonGuardar.textContent = 'Guardar tarea';
  }
});
