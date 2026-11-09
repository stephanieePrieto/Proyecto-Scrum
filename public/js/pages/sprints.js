// Responsable: Jetz - HU-06: lógica de la pantalla de sprints

/**
 * @file sprints.js
 * 
 * @author Jetzaly Josmery Tello Campos
 * @author Citlaly Morales Viveros
 */
import { montarBarraSuperior } from '../core/layout.js';
import { api } from '../core/api.js';
import { cargarPermisos } from '../core/permisos-ui.js';

montarBarraSuperior();

// Obtener el proyecto activo
const parametros = new URLSearchParams(window.location.search);

let proyectoId =
  parametros.get('proyecto') ||
  localStorage.getItem('proyectoActivo');

console.log('Proyecto activo:', proyectoId);

// Permisos del proyecto abierto
if (proyectoId) {
  cargarPermisos(Number(proyectoId)).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });
}

// El proyecto se selecciona desde Dashboard. Esta página solo consulta el proyecto activo.
if (!proyectoId) {
  const botonCrear = document.getElementById('btn-nuevo-sprint');
  botonCrear.disabled = true;
  botonCrear.title = 'Selecciona un proyecto desde Dashboard';
}

// ==========================================
// HU-06: Información del proyecto
// ==========================================

// Equipo asociado al proyecto seleccionado
let equipoId = null;

// Fechas permitidas para los sprints del proyecto
let fechaInicioProyecto = null;
let fechaFinProyecto = null;

// Consultar el equipo y las fechas del proyecto
async function obtenerEquipoProyecto() {
  const proyectoConsultado = proyectoId;

  try {
    const datos = await api(
      `/proyectos/${proyectoConsultado}`
    );

    // Ignorar respuestas de proyectos anteriores
    if (String(proyectoConsultado) !== String(proyectoId)) {
      return;
    }

    equipoId = datos.proyecto.equipo_id;

    fechaInicioProyecto =
      datos.proyecto.fecha_inicio?.slice(0, 10);

    fechaFinProyecto =
      datos.proyecto.fecha_fin?.slice(0, 10);

    // Aplicar los límites de fechas
    limitarFechasSprint();

    console.log('Equipo del proyecto:', equipoId);

    // Recalcular capacidad si ya hay fechas seleccionadas
    if (inicioSprint.value && finSprint.value) {
      await calcularCapacidadSprint();
    }

  } catch (error) {
    if (String(proyectoConsultado) !== String(proyectoId)) {
      return;
    }

    console.error('Error al consultar el proyecto:', error);
  }
}


// ==========================================
// HU-06: Elementos del formulario
// ==========================================

const botonNuevoSprint =
  document.getElementById('btn-nuevo-sprint');

const dialogoSprint =
  document.getElementById('dialogo-sprint');

const botonCancelar =
  document.getElementById('btn-cancelar-sprint');

const botonCerrarSprint =
  document.getElementById('btn-cerrar-sprint');

const formularioSprint =
  document.getElementById('formulario-sprint');

const inicioSprint =
  document.getElementById('sprint-inicio');

const finSprint =
  document.getElementById('sprint-fin');

const errorInicio =
  document.getElementById('error-inicio');

const errorFin =
  document.getElementById('error-fin');

const mensajeFormulario =
  document.getElementById('mensaje-formulario-sprint');


// ==========================================
// HU-06: Mensajes del formulario
// ==========================================

// Mostrar un mensaje de error
function mostrarErrorSprint(mensaje) {
  mensajeFormulario.textContent = mensaje;
  mensajeFormulario.hidden = false;
}

// Ocultar errores anteriores
function limpiarErrorSprint() {
  mensajeFormulario.textContent = '';
  mensajeFormulario.hidden = true;
}


// ==========================================
// HU-06: Abrir y cerrar el formulario
// ==========================================

botonNuevoSprint.addEventListener('click', () => {
  limpiarErrorSprint();

  // Ocultar mensajes de éxito anteriores
  document.getElementById('mensaje-sprints').hidden = true;

  // Reiniciar la confirmación de duración
  duracionAceptada = false;
  advertenciaDuracion.hidden = true;

  dialogoSprint.showModal();
});

// Cerrar con el botón Cancelar
botonCancelar.addEventListener('click', () => {
  dialogoSprint.close();
});

// Cerrar con el botón X
botonCerrarSprint.addEventListener('click', () => {
  dialogoSprint.close();
});


// ==========================================
// HU-06: Límites de fechas
// ==========================================

// Cargar el proyecto al abrir la página
if (proyectoId) {
  obtenerEquipoProyecto();
}

// Limitar las fechas al periodo del proyecto
function limitarFechasSprint() {
  if (!fechaInicioProyecto || !fechaFinProyecto) {
    return;
  }

  inicioSprint.min = fechaInicioProyecto;
  inicioSprint.max = fechaFinProyecto;

  finSprint.min = fechaInicioProyecto;
  finSprint.max = fechaFinProyecto;
}


// ==========================================
// HU-06: Validar fechas del sprint
// ==========================================

function validarFechasSprint() {
  // Limpiar errores anteriores
  errorInicio.textContent = '';
  errorFin.textContent = '';

  inicioSprint.removeAttribute('aria-invalid');
  finSprint.removeAttribute('aria-invalid');

  // Comprobar que ambas fechas estén seleccionadas
  if (!inicioSprint.value || !finSprint.value) {
    return false;
  }

  // La fecha final debe ser posterior a la inicial
  if (finSprint.value <= inicioSprint.value) {
    errorFin.textContent =
      'La fecha de finalización debe ser posterior a la fecha de inicio.';

    finSprint.setAttribute('aria-invalid', 'true');

    return false;
  }

  return true;
}


// ==========================================
// HU-06: Validar periodo del proyecto
// ==========================================

function validarPeriodoProyecto() {
  // Comprobar que las fechas del proyecto estén cargadas
  if (!fechaInicioProyecto || !fechaFinProyecto) {
    mostrarErrorSprint(
      'No se pudieron comprobar las fechas del proyecto.'
    );

    return false;
  }

  // No permitir fechas anteriores al proyecto
  if (inicioSprint.value < fechaInicioProyecto) {
    mostrarErrorSprint(
      `El sprint no puede comenzar antes del ${fechaInicioProyecto}.`
    );

    return false;
  }

  // No permitir fechas posteriores al proyecto
  if (finSprint.value > fechaFinProyecto) {
    mostrarErrorSprint(
      `El sprint no puede terminar después del ${fechaFinProyecto}.`
    );

    return false;
  }

  return true;
}

// ==========================================
// HU-06: Capacidad del equipo
// ==========================================

// Guardar la capacidad calculada
let capacidadCalculada = null;

// Identificar las consultas para evitar resultados antiguos
let consultaCapacidadActual = 0;

// Calcular automáticamente la capacidad del equipo
async function calcularCapacidadSprint() {
  const numeroConsulta = ++consultaCapacidadActual;

  capacidadCalculada = null;

  const textoCapacidad =
    document.getElementById('capacidad-sprint');

  textoCapacidad.textContent = 'Calculando capacidad...';

  // Comprobar que tenemos equipo y fechas válidas
  if (!equipoId || !validarFechasSprint()) {
    textoCapacidad.textContent = 'Pendiente de calcular';
    return;
  }

  // Guardar los datos usados en esta consulta
  const equipoConsultado = equipoId;
  const proyectoConsultado = proyectoId;
  const inicio = inicioSprint.value;
  const fin = finSprint.value;

  try {
    const datos = await api(
      `/capacidad/equipos/${equipoConsultado}?inicio=${inicio}&fin=${fin}`
    );

    // Ignorar respuestas de consultas anteriores
    if (
      numeroConsulta !== consultaCapacidadActual ||
      String(proyectoConsultado) !== String(proyectoId)
    ) {
      return;
    }

    capacidadCalculada = Number(datos.totalHoras);

    textoCapacidad.textContent =
      `${datos.totalHoras} horas disponibles`;

  } catch (error) {
    // Ignorar errores de consultas anteriores
    if (
      numeroConsulta !== consultaCapacidadActual ||
      String(proyectoConsultado) !== String(proyectoId)
    ) {
      return;
    }

    capacidadCalculada = null;

    console.error('Error al calcular capacidad:', error);

    textoCapacidad.textContent =
      'No se pudo calcular la capacidad';
  }
}


// ==========================================
// HU-06: Validar capacidad disponible
// ==========================================

function validarCapacidadSprint() {
  if (
    capacidadCalculada === null ||
    !Number.isFinite(capacidadCalculada) ||
    capacidadCalculada <= 0
  ) {
    mostrarErrorSprint(
      'El sprint debe tener una capacidad mayor a 0 horas.'
    );

    mensajeFormulario.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });

    return false;
  }

  return true;
}


// ==========================================
// HU-06: Actualizar capacidad al cambiar fechas
// ==========================================

inicioSprint.addEventListener('change', () => {
  limpiarErrorSprint();

  // La duración deberá confirmarse nuevamente
  duracionAceptada = false;
  advertenciaDuracion.hidden = true;

  validarFechasSprint();
  calcularCapacidadSprint();
});

finSprint.addEventListener('change', () => {
  limpiarErrorSprint();

  // La duración deberá confirmarse nuevamente
  duracionAceptada = false;
  advertenciaDuracion.hidden = true;

  validarFechasSprint();
  calcularCapacidadSprint();
});


// ==========================================
// HU-06: Advertencia de duración
// ==========================================

// Saber si el usuario aceptó una duración fuera del rango
let duracionAceptada = false;

// Elementos de la advertencia
const advertenciaDuracion = document.getElementById(
  'advertencia-duracion-sprint'
);

const textoAdvertenciaDuracion = document.getElementById(
  'texto-advertencia-duracion'
);

const botonContinuarDuracion = document.getElementById(
  'btn-continuar-duracion'
);

// Validar la duración recomendada del sprint
function validarDuracionSprint() {
  const inicio = new Date(
    `${inicioSprint.value}T00:00:00Z`
  );

  const fin = new Date(
    `${finSprint.value}T00:00:00Z`
  );

  // Contar el primer y el último día
  const duracion = Math.round(
    (fin - inicio) / (1000 * 60 * 60 * 24)
  ) + 1;

  // Duración recomendada: de 7 a 28 días
  if (duracion >= 7 && duracion <= 28) {
    advertenciaDuracion.hidden = true;
    return true;
  }

  // Permitir continuar si ya aceptó la advertencia
  if (duracionAceptada) {
    advertenciaDuracion.hidden = true;
    return true;
  }

  // Mostrar advertencia
  textoAdvertenciaDuracion.textContent =
    `Este sprint dura ${duracion} días. ` +
    'La duración recomendada es de 7 a 28 días.';

  advertenciaDuracion.hidden = false;

  advertenciaDuracion.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  });

  // Esperar la confirmación del usuario
  return false;
}

// Continuar cuando el usuario acepta la duración
botonContinuarDuracion.addEventListener('click', () => {
  duracionAceptada = true;
  advertenciaDuracion.hidden = true;

  // Reanudar el envío del formulario
  formularioSprint.requestSubmit();
});
// ==========================================
// HU-06: Crear y guardar sprints
// ==========================================

// Evitar que el formulario se envíe varias veces
let guardandoSprint = false;

// Escuchar el envío del formulario
formularioSprint.addEventListener('submit', async (evento) => {
  // Evitar que la página se recargue
  evento.preventDefault();

  // Evitar envíos duplicados
  if (guardandoSprint) {
    return;
  }

  // Comprobar que exista un proyecto seleccionado
  if (!proyectoId) {
    alert('No se ha seleccionado un proyecto.');
    return;
  }

  // Limpiar errores anteriores
  limpiarErrorSprint();

  // Validar las fechas del sprint
  if (!validarFechasSprint()) {
    mostrarErrorSprint('Revisa las fechas del sprint.');

    mensajeFormulario.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });

    return;
  }

  // Validar que las fechas estén dentro del proyecto
  if (!validarPeriodoProyecto()) {
    mensajeFormulario.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });

    return;
  }

  // Validar la duración recomendada
  if (!validarDuracionSprint()) {
    return;
  }

  // Preparar los datos para enviarlos al backend
  const datosSprint = {
    proyectoId: Number(proyectoId),
    nombre: document.getElementById('sprint-nombre').value.trim(),
    objetivo: document.getElementById('sprint-objetivo').value.trim(),
    fechaInicio: inicioSprint.value,
    fechaFin: finSprint.value
  };

  // Elementos que se bloquearán mientras se guarda
  const botonGuardar =
    document.getElementById('btn-guardar-sprint');

  const nombreSprint =
    document.getElementById('sprint-nombre');

  const objetivoSprint =
    document.getElementById('sprint-objetivo');

  try {
    guardandoSprint = true;

    // Evitar envíos repetidos
    botonGuardar.disabled = true;
    nombreSprint.disabled = true;
    objetivoSprint.disabled = true;
    inicioSprint.disabled = true;
    finSprint.disabled = true;

    // Recalcular la capacidad antes de guardar
    await calcularCapacidadSprint();

    // No permitir capacidad nula, inválida o igual a cero
    if (!validarCapacidadSprint()) {
      return;
    }

    // Enviar el sprint al backend
    await api('/sprints', {
      metodo: 'POST',
      cuerpo: datosSprint
    });

    // Limpiar el formulario después de guardar
    formularioSprint.reset();

    capacidadCalculada = null;

    document.getElementById('capacidad-sprint').textContent =
      'Pendiente de calcular';

    // Reiniciar la confirmación de duración
    duracionAceptada = false;
    advertenciaDuracion.hidden = true;

    // Cerrar el formulario
    dialogoSprint.close();

    // Mostrar mensaje de éxito
    const mensajeSprints =
      document.getElementById('mensaje-sprints');

    mensajeSprints.textContent =
      '¡Sprint creado correctamente!';

    mensajeSprints.className = 'alerta alerta--exito';
    mensajeSprints.hidden = false;

    // Actualizar las tarjetas sin recargar la página
    await cargarSprints();

  } catch (error) {
    console.error('Error al crear sprint:', error);

    // Mostrar el mensaje enviado por el backend
    const mensaje =
      error.cuerpo?.mensaje ||
      'No se pudo crear el sprint. Inténtalo nuevamente.';

    mostrarErrorSprint(mensaje);

    mensajeFormulario.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });

  } finally {
    guardandoSprint = false;

    // Habilitar nuevamente el formulario
    botonGuardar.disabled = false;
    nombreSprint.disabled = false;
    objetivoSprint.disabled = false;
    inicioSprint.disabled = false;
    finSprint.disabled = false;
  }
});

// Detalle general al seleccionar una tarjeta de sprint.
const dialogoDetalleSprint = document.getElementById('dialogo-detalle-sprint');

function abrirDetalleSprint(sprint, fechas, capacidad) {
  document.getElementById('detalle-sprint-nombre').textContent = sprint.nombre || 'Sin nombre';
  document.getElementById('detalle-sprint-objetivo').textContent = sprint.objetivo || 'Sin objetivo';
  document.getElementById('detalle-sprint-fechas').textContent = fechas;
  document.getElementById('detalle-sprint-estado').textContent = sprint.estado || 'Sin estado';
  document.getElementById('detalle-sprint-capacidad').textContent = capacidad;

  const destino = new URL('planificacion-sprint.html', window.location.href);
  destino.searchParams.set('proyecto', String(proyectoId));
  destino.searchParams.set('sprint', String(sprint.id));
  document.getElementById('enlace-planificar-sprint').href = destino.pathname + destino.search;
  dialogoDetalleSprint.showModal();
}

document.getElementById('btn-cerrar-detalle-sprint')
  .addEventListener('click', () => dialogoDetalleSprint.close());
document.getElementById('btn-volver-detalle-sprint')
  .addEventListener('click', () => dialogoDetalleSprint.close());

// ==========================================
// HU-06: Consultar y mostrar los sprints
// ==========================================

async function cargarSprints() {
  const lista = document.getElementById('lista-sprints');

  // Identificar a qué proyecto pertenece la consulta
  const proyectoConsultado = proyectoId;

  lista.textContent = 'Cargando sprints...';

  if (!proyectoConsultado) {
    lista.textContent = 'No hay un proyecto seleccionado.';
    return;
  }

  try {
    // Consultar los sprints guardados en PostgreSQL
    const datos = await api(
      `/sprints/proyectos/${proyectoConsultado}`
    );

    // Ignorar respuestas de proyectos anteriores
    if (String(proyectoConsultado) !== String(proyectoId)) {
      return;
    }

    // Limpiar las tarjetas anteriores
    lista.replaceChildren();

    // Mostrar mensaje si el proyecto no tiene sprints
    if (!datos.sprints || datos.sprints.length === 0) {
      const mensaje = document.createElement('p');

      mensaje.className = 'subtitulo-pagina';
      mensaje.textContent =
        'Todavía no hay sprints registrados en este proyecto.';

      lista.appendChild(mensaje);
      return;
    }

    // Crear una tarjeta por cada sprint
    datos.sprints.forEach((sprint) => {
      const tarjeta = document.createElement('article');
      tarjeta.className = 'tarjeta sprint-tarjeta';
      tarjeta.tabIndex = 0;
      tarjeta.setAttribute('role', 'button');
      tarjeta.setAttribute('aria-haspopup', 'dialog');
      tarjeta.setAttribute('aria-label', `Ver información del sprint ${sprint.nombre}`);

      // Nombre del sprint
      const titulo = document.createElement('h3');
      titulo.textContent = sprint.nombre;

      // Objetivo del sprint
      const objetivo = document.createElement('p');
      objetivo.textContent = sprint.objetivo;

      // Fechas del sprint
      const fechas = document.createElement('p');

      const inicio = String(sprint.fecha_inicio).slice(0, 10);
      const fin = String(sprint.fecha_fin).slice(0, 10);

      // Formatear las fechas para mostrarlas
      const formatoFecha = (fecha) => {
        const [anio, mes, dia] = fecha.split('-');

        return new Date(
          Number(anio),
          Number(mes) - 1,
          Number(dia)
        ).toLocaleDateString('es-MX', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
      };

      fechas.textContent =
        `${formatoFecha(inicio)} – ${formatoFecha(fin)}`;

      // Capacidad del equipo
      const capacidad = document.createElement('p');
      const horas = Number(sprint.capacidad_horas);

      capacidad.textContent =
        `Capacidad del equipo: ${horas.toLocaleString('es-MX')} horas`;

      // Estado del sprint
      const estado = document.createElement('span');

      estado.className = 'insignia';
      estado.style.alignSelf = 'flex-start';

      if (sprint.estado === 'activo') {
        estado.classList.add('insignia--exito');

      } else if (sprint.estado === 'planificado') {
        estado.classList.add('insignia--info');

      } else if (sprint.estado === 'finalizado') {
        estado.classList.add('insignia--neutro');
      }

      estado.textContent = sprint.estado;

      // Cabecera con nombre y estado
      const cabecera = document.createElement('div');
      cabecera.className = 'equipo__cabecera';

      cabecera.append(titulo, estado);

      // Separador visual
      const separador = document.createElement('hr');

      // Agregar los elementos a la tarjeta
      tarjeta.append(
        cabecera,
        objetivo,
        separador,
        fechas,
        capacidad
      );

      tarjeta.addEventListener('click', () => {
        abrirDetalleSprint(sprint, fechas.textContent, capacidad.textContent);
      });
      tarjeta.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') {
          evento.preventDefault();
          abrirDetalleSprint(sprint, fechas.textContent, capacidad.textContent);
        }
      });

      lista.appendChild(tarjeta);
    });

  } catch (error) {
    // Ignorar errores de proyectos anteriores
    if (String(proyectoConsultado) !== String(proyectoId)) {
      return;
    }

    console.error('Error al cargar sprints:', error);

    lista.textContent = 'No se pudieron cargar los sprints.';
  }
}

// Cargar los sprints al abrir la página
cargarSprints();