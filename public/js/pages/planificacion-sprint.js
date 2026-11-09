// Responsable: Jetz - HU-07, HU-08: logica de la pantalla de planificacion con medidor de capacidad y tareas (llama a la API y escucha sockets)

/**
 * @file planificacion-sprint.js
 * HU-08: Planificación del Sprint
 * Navegación entre proyectos.
 *
 * @author Jetzaly Josmery Tello Campos
 * @author Citlaly Morales Viveros
 */

import { montarBarraSuperior } from '../core/layout.js';
import { api } from '../core/api.js';
import { cargarPermisos, rolActual, tienePermiso } from '../core/permisos-ui.js';

// Barra superior compartida de AgileDesk
montarBarraSuperior();

// ==========================================
// Proyecto seleccionado
// ==========================================

const parametros = new URLSearchParams(window.location.search);

// HU-07: conservar la capacidad informada por el servidor para cada Sprint.
let sprintsDisponibles = [];

let proyectoId =
  parametros.get('proyecto') ||
  localStorage.getItem('proyectoActivo');

const enlaceVolver =
  document.getElementById('enlace-volver-sprints');

// Modo de consulta en Planificación: el rol se obtiene del servidor para el proyecto actual.
// Este control es de interfaz; la autorización de cada API sigue siendo responsabilidad del servidor.
function puedeEditarEnPlanificacion() {
  return ['scrum_master', 'product_owner'].includes(rolActual()) &&
    tienePermiso('tarea.gestionar');
}

function prepararControlEdicion(boton) {
  boton.dataset.planificacionEditar = 'true';
  const permitido = puedeEditarEnPlanificacion();
  boton.style.display = permitido ? '' : 'none';
  boton.disabled = !permitido;
}

function actualizarModoPlanificacion() {
  const permitido = puedeEditarEnPlanificacion();
  document.querySelectorAll('[data-planificacion-editar]').forEach((boton) => {
    boton.style.display = permitido ? '' : 'none';
    boton.disabled = !permitido;
  });

  const aviso = document.getElementById('planificacion-aviso-lectura');
  if (aviso) aviso.hidden = rolActual() !== 'developer';

  // Si el rol cambia mientras hay un formulario abierto, dejar de permitir ediciones.
  if (!permitido) {
    document.getElementById('dialogo-tarea')?.open &&
      document.getElementById('dialogo-tarea').close();
    document.getElementById('dialogo-eliminar-tarea')?.open &&
      document.getElementById('dialogo-eliminar-tarea').close();
  }
}

window.addEventListener('permisos:actualizados', (evento) => {
  if (String(evento.detail?.proyectoId) === String(proyectoId)) {
    actualizarModoPlanificacion();
    if (historiasDisponiblesActuales.length) mostrarBacklogDisponible(historiasDisponiblesActuales);
    if (historiasSprintActuales.length) mostrarHistoriasSprint(historiasSprintActuales);
  }
});

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
    sprintsDisponibles = sprints;

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

    // Si venimos del detalle de Sprints, seleccionar ese sprint del mismo proyecto.
    const sprintSolicitado = parametros.get('sprint');
    if (sprintSolicitado && sprints.some(sprint => String(sprint.id) === sprintSolicitado)) {
      selector.value = sprintSolicitado;
      selector.dispatchEvent(new Event('change'));
    }

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
  if (!proyectoId) {
    const mensaje = document.getElementById('mensaje-planificacion');
    mensaje.className = 'alerta alerta--advertencia';
    mensaje.textContent = 'Selecciona un proyecto desde Dashboard para consultar su planificación.';
    mensaje.hidden = false;
    return;
  }

  cargarPermisos(Number(proyectoId)).catch(() => { /* los permisos se validan también en el servidor */ });
  await cargarSprintsProyecto();
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

      detalle.textContent = `Responsable: ${responsable}`;

      const insigniaHoras = document.createElement('span');
      insigniaHoras.className =
        'insignia insignia--primario planificacion-tarea__horas';

      insigniaHoras.textContent = `${Number(tarea.horas_estimadas).toFixed(1)} h`;

      // HU-08: Botón para editar esta tarea técnica.
      const botonEditar = document.createElement('button');
      botonEditar.type = 'button';
      botonEditar.className =
        'boton boton--secundario boton--pequeno';
      botonEditar.textContent = 'Editar';
      prepararControlEdicion(botonEditar);

      botonEditar.addEventListener('click', async () => {
        if (!puedeEditarEnPlanificacion()) return;
        // Preparar el formulario con los datos actuales.
        prepararFormularioTarea(tarea);

        // Mostrar la historia a la que pertenece.
        const nombreHistoria = contenedor.closest(
          '.planificacion-historia'
        )?.querySelector('.planificacion-historia__titulo');

        document.getElementById('historia-tarea-nombre').textContent =
          nombreHistoria?.textContent || '';

        // Abrir el modal.
        dialogoTarea.showModal();

        // Cargar los responsables y seleccionar el actual.
        await cargarResponsables(tarea.responsable_id);
      });


      // HU-08: Botón para eliminar una tarea técnica.
      const botonEliminar = document.createElement('button');
      botonEliminar.type = 'button';
      botonEliminar.className =
        'boton boton--secundario boton--pequeno';
      botonEliminar.textContent = 'Eliminar';
      prepararControlEdicion(botonEliminar);


      botonEliminar.addEventListener('click', () => {
        if (!puedeEditarEnPlanificacion()) return;
        // HU-08: Preparar la tarea que se desea eliminar.
        tareaPendienteEliminar = tarea.id;

        nombreTareaEliminar.textContent = tarea.titulo;

        mensajeEliminarTarea.hidden = true;
        mensajeEliminarTarea.textContent = '';

        dialogoEliminarTarea.showModal();
      });


      // HU-08: Confirmar eliminación desde el modal personalizado.
      botonConfirmarEliminar.addEventListener('click', async () => {
        if (!puedeEditarEnPlanificacion()) return;
        if (!tareaPendienteEliminar) return;

        const tareaId = tareaPendienteEliminar;

        botonConfirmarEliminar.disabled = true;
        botonConfirmarEliminar.textContent = 'Eliminando...';

        try {
          await api(`/tareas/${tareaId}`, {
            metodo: 'DELETE'
          });

          dialogoEliminarTarea.close();

          // Actualizar las tareas y los totales del Sprint.
          selectorSprint.dispatchEvent(new Event('change'));

        } catch (error) {
          console.error('Error al eliminar tarea técnica:', error);

          mensajeEliminarTarea.textContent =
            error.cuerpo?.mensaje ||
            error.message ||
            'No se pudo eliminar la tarea técnica.';

          mensajeEliminarTarea.hidden = false;

        } finally {
          botonConfirmarEliminar.disabled = false;
          botonConfirmarEliminar.textContent = 'Eliminar tarea';
        }
      });



      const accionesTarea = document.createElement('div');
      accionesTarea.className = 'planificacion-tarea__acciones';

      accionesTarea.append(insigniaHoras, botonEditar, botonEliminar);

      tarjeta.append(titulo, detalle, accionesTarea);
      contenedor.appendChild(tarjeta);

    });

    // HU-08: Sumar las horas estimadas de esta historia.
    const totalHorasHistoria = tareas.reduce(
      (total, tarea) =>
        total + (Number(tarea.horas_estimadas) || 0),
      0
    );

    // Crear un resumen debajo de las tareas técnicas.
    // Crear el resumen visual de horas de la historia.
    const resumenHoras = document.createElement('div');
    resumenHoras.className = 'planificacion-historia__total-horas';


    const etiquetaHoras = document.createElement('span');
    etiquetaHoras.className = 'planificacion-historia__horas-etiqueta';

    // Icono SVG de reloj, estilo Dashboard.
    etiquetaHoras.innerHTML = `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 7v5l3 2"></path>
      </svg>
      <span>Horas estimadas de la historia</span>
    `;

    const valorHoras = document.createElement('span');
    valorHoras.className = 'planificacion-historia__horas-valor';
    valorHoras.textContent =
      `${Math.round(totalHorasHistoria * 10) / 10} h`;

    resumenHoras.append(etiquetaHoras, valorHoras);
    contenedor.appendChild(resumenHoras);


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
async function actualizarContadoresTareas(historias, versionActual) {
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

    actualizarIndicadoresCompromiso(historias, totalHoras);


  } catch (error) {
    console.error('Error al calcular los contadores:', error);

    // Ignorar errores de consultas anteriores.
    if (versionActual !== versionConsultaSprint) return;

    // Mostrar un guion si falla la consulta.
    contadorTareas.textContent = '—';
    contadorHoras.textContent = '—';
    actualizarIndicadoresCompromiso(historias, null);
  }
}


// HU-07: usar el mismo estilo de confirmación que el modal de tareas.
// Devuelve null si se cancela, o el texto capturado cuando se confirma.
function solicitarConfirmacionPlanificacion({ titulo, mensaje, accion = 'Confirmar',
  requiereJustificacion = false, peligro = false }) {
  const dialogo = document.getElementById('dialogo-confirmar-planificacion');
  const tituloElemento = document.getElementById('titulo-confirmar-planificacion');
  const mensajeElemento = document.getElementById('detalle-confirmar-planificacion');
  const campo = document.getElementById('justificacion-confirmar-planificacion');
  const grupoCampo = document.getElementById('grupo-justificacion-planificacion');
  const errorElemento = document.getElementById('error-confirmar-planificacion');
  const botonAceptar = document.getElementById('btn-aceptar-confirmar-planificacion');
  const botonCancelar = document.getElementById('btn-cancelar-confirmar-planificacion');

  tituloElemento.textContent = titulo;
  mensajeElemento.textContent = mensaje;
  botonAceptar.textContent = accion;
  botonAceptar.classList.toggle('boton--peligro', peligro);
  botonAceptar.classList.toggle('eq-peligro', peligro);
  grupoCampo.hidden = !requiereJustificacion;
  campo.value = '';
  errorElemento.hidden = true;
  errorElemento.textContent = '';

  return new Promise((resolver) => {
    let resuelto = false;
    function terminar(resultado) {
      if (resuelto) return;
      resuelto = true;
      botonAceptar.removeEventListener('click', aceptar);
      botonCancelar.removeEventListener('click', cancelar);
      dialogo.removeEventListener('close', cerrar);
      if (dialogo.open) dialogo.close();
      resolver(resultado);
    }
    function aceptar() {
      const valor = campo.value.trim();
      if (requiereJustificacion && valor.length < 10) {
        errorElemento.textContent = 'La justificación debe tener al menos 10 caracteres.';
        errorElemento.hidden = false;
        campo.focus();
        return;
      }
      terminar({ confirmado: true, valor });
    }
    function cancelar() { terminar(null); }
    function cerrar() { terminar(null); } // Incluye Escape del teclado.
    botonAceptar.addEventListener('click', aceptar);
    botonCancelar.addEventListener('click', cancelar);
    dialogo.addEventListener('close', cerrar);
    dialogo.showModal();
    if (requiereJustificacion) campo.focus();
    else botonCancelar.focus();
  });
}

// HU-07: planificación por proyecto. El servidor vuelve a verificar rol, sprint y versión.
function puedeComprometerHistoria() {
  return ['scrum_master', 'product_owner'].includes(rolActual()) &&
    tienePermiso('historia.gestionar');
}

let compromisoEnCurso = false;
async function agregarHistoriaAlSprint(historia) {
  if (compromisoEnCurso || !puedeComprometerHistoria() || !selectorSprint.value) return;
  const sprint = sprintsDisponibles.find(s => String(s.id) === selectorSprint.value);
  if (!sprint || sprint.estado === 'cerrado') return;
  const proyectoMovimiento = String(proyectoId);
  const sprintMovimiento = String(selectorSprint.value);
  let confirmarSprintIniciado = false;
  if (sprint.estado === 'activo') {
    const confirmacion = await solicitarConfirmacionPlanificacion({
      titulo: 'Modificar sprint iniciado',
      mensaje: 'Este sprint ya inició. ¿Deseas agregar esta historia y cambiar su planificación?',
      accion: 'Agregar historia'
    });
    if (!confirmacion || proyectoMovimiento !== String(proyectoId) ||
        sprintMovimiento !== selectorSprint.value) return;
    confirmarSprintIniciado = true;
  }
  const mensaje = document.getElementById('mensaje-planificacion');
  let justificacion = '';
  compromisoEnCurso = true;
  try {
    for (;;) {
      try {
        const respuesta = await api(`/sprints/proyectos/${proyectoMovimiento}/${sprintMovimiento}/historias/${historia.id}`, {
          metodo: 'POST',
          cuerpo: { version: historia.version, confirmarSprintIniciado, justificacion }
        });
        if (proyectoMovimiento === String(proyectoId) && sprintMovimiento === selectorSprint.value) {
          selectorSprint.dispatchEvent(new Event('change'));
          mensaje.className = respuesta.aviso ? 'alerta alerta--advertencia' : 'alerta alerta--exito';
          mensaje.textContent = respuesta.aviso || respuesta.mensaje;
          mensaje.hidden = false;
        }
        break;
      } catch (error) {
        const detalle = error.cuerpo?.mensaje || error.message || 'No se pudo planificar la historia.';
        if (error.estado === 409 && detalle.includes('supera el 100 %') && rolActual() === 'scrum_master') {
          const confirmacion = await solicitarConfirmacionPlanificacion({
            titulo: 'Capacidad del sprint superada',
            mensaje: 'El compromiso supera el 100 % de la capacidad. Como Scrum Master, debes justificar este cambio antes de continuar.',
            accion: 'Confirmar compromiso',
            requiereJustificacion: true
          });
          if (!confirmacion || proyectoMovimiento !== String(proyectoId) ||
              sprintMovimiento !== selectorSprint.value) break;
          justificacion = confirmacion.valor;
          continue;
        }
        mensaje.className = 'alerta alerta--error';
        mensaje.textContent = detalle;
        mensaje.hidden = false;
        if (error.estado === 409) selectorSprint.dispatchEvent(new Event('change'));
        break;
      }
    }
  } finally {
    compromisoEnCurso = false;
  }
}

// HU-07: devolución voluntaria con advertencia. Las tareas permanecen en la historia.
let devolucionEnCurso = false;
async function devolverHistoriaAlBacklog(historia) {
  if (devolucionEnCurso || compromisoEnCurso || !puedeComprometerHistoria() || !selectorSprint.value) return;
  const sprint = sprintsDisponibles.find(s => String(s.id) === selectorSprint.value);
  if (!sprint || sprint.estado === 'cerrado') return;
  const proyectoMovimiento = String(proyectoId);
  const sprintMovimiento = String(selectorSprint.value);
  const mensaje = document.getElementById('mensaje-planificacion');

  // No permitir la devolución sin saber si hay tareas: el aviso debe ser preciso.
  let tareas;
  try {
    const respuesta = await api(`/tareas/historia/${historia.id}`);
    tareas = respuesta.tareas || [];
  } catch (error) {
    mensaje.className = 'alerta alerta--error';
    mensaje.textContent = 'No se pudo comprobar si la historia tiene tareas. No se realizó ningún cambio.';
    mensaje.hidden = false;
    return;
  }
  if (proyectoMovimiento !== String(proyectoId) || sprintMovimiento !== selectorSprint.value) return;

  const nombre = `HU-${String(historia.numero_hu).padStart(2, '0')} · ${historia.titulo}`;
  const advertencia = tareas.length
    ? `Esta historia tiene ${tareas.length} tarea(s) técnica(s). No se borrarán, pero dejarán de pertenecer al sprint y al tablero.\n\n`
    : 'Esta historia no tiene tareas técnicas registradas.\n\n';
  const avisoSprint = sprint.estado === 'activo'
    ? 'Este sprint ya inició. Devolver la historia modificará su planificación.\n\n'
    : '';
  const confirmacion = await solicitarConfirmacionPlanificacion({
    titulo: '¿Devolver historia al Product Backlog?',
    mensaje: `${nombre}\n\n${advertencia}${avisoSprint}Se actualizarán los puntos y las horas comprometidas.`,
    accion: 'Confirmar devolución',
    peligro: true
  });
  if (!confirmacion || proyectoMovimiento !== String(proyectoId) ||
      sprintMovimiento !== selectorSprint.value) return;
  const confirmarSprintIniciado = sprint.estado === 'activo';
  devolucionEnCurso = true;
  try {
    const respuesta = await api(`/sprints/proyectos/${proyectoMovimiento}/${sprintMovimiento}/historias/${historia.id}/devolver`, {
      metodo: 'POST',
      cuerpo: { version: historia.version, confirmarDevolucion: true, confirmarSprintIniciado }
    });
    if (proyectoMovimiento === String(proyectoId) && sprintMovimiento === selectorSprint.value) {
      selectorSprint.dispatchEvent(new Event('change'));
      mensaje.className = respuesta.aviso ? 'alerta alerta--advertencia' : 'alerta alerta--exito';
      mensaje.textContent = respuesta.aviso || respuesta.mensaje;
      mensaje.hidden = false;
    }
  } catch (error) {
    mensaje.className = 'alerta alerta--error';
    mensaje.textContent = error.cuerpo?.mensaje || error.message || 'No se pudo devolver la historia.';
    mensaje.hidden = false;
    if (error.estado === 409) selectorSprint.dispatchEvent(new Event('change'));
  } finally {
    devolucionEnCurso = false;
  }
}

// HU-07: arrastrar al Sprint Backlog; el botón permite hacerlo con teclado o móvil.
let historiasDisponiblesActuales = [];
function mostrarBacklogDisponible(historias) {
  const lista = document.getElementById('lista-historias-disponibles');
  const contador = document.getElementById('total-historias-disponibles');
  lista.replaceChildren();
  const disponibles = historias.filter(historia =>
    historia.estado === 'backlog' && !historia.sprint_id && !historia.propuesta
  );
  contador.textContent = String(disponibles.length);
  historiasDisponiblesActuales = disponibles;

  if (!disponibles.length) {
    const aviso = document.createElement('p');
    aviso.className = 'tarjeta planificacion-vacio';
    aviso.textContent = 'No hay historias disponibles para planificar en este proyecto.';
    lista.appendChild(aviso);
    return;
  }

  disponibles.forEach(historia => {
    const tarjeta = document.createElement('article');
    tarjeta.className = 'tarjeta planificacion-disponible';
    const nombre = document.createElement('strong');
    nombre.textContent = `HU-${String(historia.numero_hu).padStart(2, '0')} · ${historia.titulo}`;
    const puntos = document.createElement('span');
    puntos.className = 'planificacion-disponible__puntos';
    puntos.textContent = historia.puntos == null
      ? 'Sin puntos estimados'
      : `${historia.puntos} puntos`;
    if (historia.puntos == null) puntos.classList.add('planificacion-disponible__puntos--pendiente');
    tarjeta.append(nombre, puntos);
    const permitido = puedeComprometerHistoria() && historia.puntos != null;
    const sprint = sprintsDisponibles.find(s => String(s.id) === selectorSprint.value);
    const editable = permitido && sprint?.estado !== 'cerrado';
    tarjeta.draggable = Boolean(editable);
    if (editable) {
      tarjeta.title = 'Arrastra esta historia al Sprint Backlog';
      tarjeta.addEventListener('dragstart', evento => {
        if (!puedeComprometerHistoria()) { evento.preventDefault(); return; }
        evento.dataTransfer.setData('text/plain', String(historia.id));
        evento.dataTransfer.effectAllowed = 'move';
      });
    }
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton boton--secundario boton--pequeno';
    boton.textContent = 'Agregar al sprint';
    boton.disabled = !editable;
    boton.hidden = !puedeComprometerHistoria();
    boton.title = historia.puntos == null ? 'Primero estima los puntos de la historia' : '';
    boton.addEventListener('click', () => agregarHistoriaAlSprint(historia));
    tarjeta.appendChild(boton);
    lista.appendChild(tarjeta);
  });
}

// HU-07: indicadores informativos; la autorización y los límites deben validarse en API.
function actualizarIndicadoresCompromiso(historias, horas) {
  const puntos = historias.reduce((suma, historia) => suma + (Number(historia.puntos) || 0), 0);
  document.getElementById('total-puntos').textContent = `${puntos} pts`;

  const sprint = sprintsDisponibles.find(s => String(s.id) === selectorSprint.value);
  const bloque = document.getElementById('planificacion-capacidad');
  bloque.hidden = !sprint;
  if (!sprint) return;

  const capacidad = Number(sprint.capacidad_horas);
  const etiqueta = document.getElementById('planificacion-capacidad-texto');
  const barra = document.getElementById('planificacion-capacidad-barra');
  const aviso = document.getElementById('planificacion-capacidad-aviso');
  bloque.classList.remove('planificacion-capacidad--amarillo', 'planificacion-capacidad--rojo');
  barra.style.width = '0%';
  barra.setAttribute('aria-valuenow', '0');
  aviso.textContent = '';

  if (horas === null || !Number.isFinite(capacidad) || capacidad <= 0) {
    etiqueta.textContent = horas === null ? 'No se pudieron calcular las horas comprometidas.' : 'Capacidad del Sprint no disponible.';
    return;
  }

  const porcentaje = horas / capacidad * 100;
  const redondear = numero => Math.round(numero * 10) / 10;
  etiqueta.textContent = `${redondear(horas)} de ${redondear(capacidad)} h comprometidas · ${redondear(porcentaje)} %`;
  barra.style.width = `${Math.min(100, Math.max(0, porcentaje))}%`;
  barra.setAttribute('aria-valuenow', String(redondear(Math.min(100, porcentaje))));

  if (porcentaje > 100) {
    bloque.classList.add('planificacion-capacidad--rojo');
    aviso.textContent = 'Capacidad superada. Solo el Scrum Master puede confirmar nuevos compromisos con justificación.';
  } else if (porcentaje > 90) {
    bloque.classList.add('planificacion-capacidad--amarillo');
    aviso.textContent = 'Advertencia: el compromiso supera el 90 % de la capacidad.';
  }
}

// Historias visibles en el Sprint seleccionado, para permitir arrastrarlas de regreso.
let historiasSprintActuales = [];
// HU-08: Mostrar las historias asignadas al Sprint
function mostrarHistoriasSprint(historias) {
  historiasSprintActuales = historias;
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
    const sprint = sprintsDisponibles.find(s => String(s.id) === selectorSprint.value);
    const puedeDevolver = puedeComprometerHistoria() && sprint?.estado !== 'cerrado' && historia.estado === 'en_sprint';
    tarjeta.draggable = Boolean(puedeDevolver);
    if (puedeDevolver) {
      tarjeta.title = 'Arrastra al Product Backlog para devolver esta historia';
      tarjeta.addEventListener('dragstart', evento => {
        if (!puedeComprometerHistoria()) { evento.preventDefault(); return; }
        evento.dataTransfer.setData('application/x-scrumflow-sprint-historia', String(historia.id));
        evento.dataTransfer.effectAllowed = 'move';
      });
    }

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
    prepararControlEdicion(botonAgregarTarea);


    botonAgregarTarea.addEventListener('click', () => {
      if (!puedeEditarEnPlanificacion()) return;
      // HU-08: Preparar el formulario en modo creación.
      prepararFormularioTarea();

      // Guardar la historia a la que pertenecerá la tarea.
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

    // Alternativa accesible al arrastre para devolver la historia al Product Backlog.
    if (puedeDevolver) {
      const botonDevolver = document.createElement('button');
      botonDevolver.type = 'button';
      botonDevolver.className = 'boton boton--secundario boton--pequeno planificacion-boton-devolver';
      botonDevolver.textContent = 'Devolver al Product Backlog';
      botonDevolver.addEventListener('click', () => devolverHistoriaAlBacklog(historia));
      contenido.appendChild(botonDevolver);
    }

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

// Arrastrar de vuelta al Product Backlog. Se solicita confirmación antes de guardar.
const destinoBacklog = document.getElementById('lista-historias-disponibles');
destinoBacklog.addEventListener('dragover', evento => {
  if (!puedeComprometerHistoria() || !selectorSprint.value ||
      !Array.from(evento.dataTransfer.types).includes('application/x-scrumflow-sprint-historia')) return;
  evento.preventDefault();
  evento.dataTransfer.dropEffect = 'move';
});
destinoBacklog.addEventListener('drop', evento => {
  if (!puedeComprometerHistoria()) return;
  const id = Number(evento.dataTransfer.getData('application/x-scrumflow-sprint-historia'));
  const historia = historiasSprintActuales.find(h => Number(h.id) === id);
  if (!historia) return;
  evento.preventDefault();
  devolverHistoriaAlBacklog(historia);
});

// El destino recibe la historia solo si pertenece al Product Backlog del proyecto actual.
const destinoSprint = document.getElementById('lista-historias-sprint');
destinoSprint.addEventListener('dragover', evento => {
  if (!puedeComprometerHistoria() || !selectorSprint.value) return;
  evento.preventDefault();
  evento.dataTransfer.dropEffect = 'move';
});
destinoSprint.addEventListener('drop', evento => {
  if (!puedeComprometerHistoria()) return;
  evento.preventDefault();
  const id = Number(evento.dataTransfer.getData('text/plain'));
  const historia = historiasDisponiblesActuales.find(h => Number(h.id) === id);
  if (historia) agregarHistoriaAlSprint(historia);
});

selectorSprint.addEventListener('change', async () => {
  const sprintId = selectorSprint.value;
  const versionActual = ++versionConsultaSprint;
  const proyectoActual = proyectoId;

  // Evitar mostrar los datos del Sprint anterior mientras se cambia de selección.
  document.getElementById('lista-historias-disponibles').replaceChildren();
  historiasDisponiblesActuales = [];
  document.getElementById('total-historias-disponibles').textContent = '0';
  mostrarHistoriasSprint([]);
  document.getElementById('total-tareas').textContent = '0';
  document.getElementById('total-horas').textContent = '0 h';
  actualizarIndicadoresCompromiso([], 0);

  if (!sprintId) return;

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


    mostrarBacklogDisponible(datos.historias || []);

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
    const mensaje = document.getElementById('mensaje-planificacion');
    mensaje.className = 'alerta alerta--error';
    mensaje.textContent = 'No se pudieron consultar las historias de este proyecto.';
    mensaje.hidden = false;
  }
});

// HU-08: Modal personalizado para eliminar tareas técnicas.
const dialogoEliminarTarea =
  document.getElementById('dialogo-eliminar-tarea');

const nombreTareaEliminar =
  document.getElementById('nombre-tarea-eliminar');

const mensajeEliminarTarea =
  document.getElementById('mensaje-eliminar-tarea');

const botonConfirmarEliminar =
  document.getElementById('btn-confirmar-eliminar-tarea');

// Guardar la tarea seleccionada para eliminar.
let tareaPendienteEliminar = null;

function cerrarModalEliminarTarea() {
  dialogoEliminarTarea.close();
}

document.getElementById('btn-cancelar-eliminar-tarea')
  .addEventListener('click', cerrarModalEliminarTarea);

dialogoEliminarTarea.addEventListener('close', () => {
  tareaPendienteEliminar = null;
  mensajeEliminarTarea.hidden = true;
  mensajeEliminarTarea.textContent = '';
});

// HU-08: Control del modal de tareas técnicas
const dialogoTarea = document.getElementById('dialogo-tarea');
const formularioTarea = document.getElementById('formulario-tarea');

/**
 * HU-08: Preparar el formulario para crear o editar tareas.
 */
function prepararFormularioTarea(tarea = null) {
  const campoTareaId = document.getElementById('tarea-id');
  const tituloDialogo = document.getElementById('titulo-dialogo-tarea');
  const botonGuardar = document.getElementById('btn-guardar-tarea');

  if (tarea) {
    // Modo edición: cargar los datos existentes.
    campoTareaId.value = tarea.id;
    tituloDialogo.textContent = 'Editar tarea técnica';
    botonGuardar.textContent = 'Guardar cambios';

    document.getElementById('tarea-historia-id').value =
      tarea.historia_id;

    document.getElementById('tarea-titulo').value = tarea.titulo;
    document.getElementById('tarea-descripcion').value =
      tarea.descripcion || '';

    document.getElementById('tarea-horas').value =
      tarea.horas_estimadas;

  } else {
    // Modo creación: preparar un formulario vacío.
    formularioTarea.reset();
    campoTareaId.value = '';

    tituloDialogo.textContent = 'Agregar tarea técnica';
    botonGuardar.textContent = 'Guardar tarea';
  }
}

// HU-08: Cargar integrantes del equipo como responsables
async function cargarResponsables(responsableSeleccionado = null) {
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

    // HU-08: Seleccionar al responsable actual al editar.
    if (responsableSeleccionado !== null) {
      selector.value = String(responsableSeleccionado);
    }

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
  if (!puedeEditarEnPlanificacion()) return;

  const titulo = document.getElementById('tarea-titulo').value.trim();
  const responsableId = document.getElementById('tarea-responsable').value;
  const horasTexto = document.getElementById('tarea-horas').value;
  const descripcion = document.getElementById('tarea-descripcion').value.trim();
  const historiaId = document.getElementById('tarea-historia-id').value;
  // HU-08: Identificar si estamos creando o editando.
  const tareaId = document.getElementById('tarea-id').value;
  const esEdicion = Boolean(tareaId);

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

    // HU-08: Distinguir entre crear y editar una tarea.
    const ruta = esEdicion ? `/tareas/${tareaId}` : '/tareas';
    const metodo = esEdicion ? 'PUT' : 'POST';

    await api(ruta, {
      metodo,
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

    // HU-08: Mantener el texto según el modo del formulario.
    botonGuardar.textContent = esEdicion
      ? 'Guardar cambios'
      : 'Guardar tarea';
  }

});
