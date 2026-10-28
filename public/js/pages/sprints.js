// Responsable: Jetz - HU-06: logica de la pantalla con la lista de sprints y crear sprint (llama a la API y escucha sockets)

import { montarBarraSuperior } from '../core/layout.js';
import { api } from '../core/api.js';

montarBarraSuperior();

// Obtener el proyecto activo
const parametros = new URLSearchParams(window.location.search);

const proyectoId =
  parametros.get('proyecto') ||
  localStorage.getItem('proyectoActivo');

console.log('Proyecto activo:', proyectoId);

//Consultar el equipo asociado al proyecto
let equipoId = null;

// Fechas permitidas para los sprints del proyecto
let fechaInicioProyecto = null;
let fechaFinProyecto = null;

async function obtenerEquipoProyecto() {
  try {
    const datos = await api(`/proyectos/${proyectoId}`);

    equipoId = datos.proyecto.equipo_id;

    fechaInicioProyecto = datos.proyecto.fecha_inicio?.slice(0, 10);
    fechaFinProyecto = datos.proyecto.fecha_fin?.slice(0, 10);

    // Aplicar los límites después de recibir las fechas
    limitarFechasSprint();

    // Guardar las fechas del proyecto
        fechaFinProyecto = datos.proyecto.fecha_fin?.slice(0, 10);

    console.log('Equipo del proyecto:', equipoId);

    // Calcular la capacidad si las fechas ya están seleccionadas
    if (inicioSprint.value && finSprint.value) {
    await calcularCapacidadSprint();
    }

  } catch (error) {
    console.error('Error al consultar el proyecto:', error);
  }
}


const botonNuevoSprint = document.getElementById('btn-nuevo-sprint');
const dialogoSprint = document.getElementById('dialogo-sprint');
const botonCancelar = document.getElementById('btn-cancelar-sprint');


botonNuevoSprint.addEventListener('click', () => {
  // Limpiar errores anteriores
  limpiarErrorSprint();

  // Reiniciar la confirmación de duración
  duracionAceptada = false;
  advertenciaDuracion.hidden = true;

  // Abrir el formulario
  dialogoSprint.showModal();
});


// Cerrar el formulario
botonCancelar.addEventListener('click', () => {
  dialogoSprint.close();
});

const botonCerrarSprint = document.getElementById('btn-cerrar-sprint');

botonCerrarSprint.addEventListener('click', () => {
  dialogoSprint.close();
});

const formularioSprint = document.getElementById('formulario-sprint');


/* Mostrar advertencias dentro del formulario */

// Obtener el espacio de mensajes del HTML
const mensajeFormulario = document.getElementById('mensaje-formulario-sprint');

// Mostrar una advertencia
function mostrarErrorSprint(mensaje) {
  mensajeFormulario.textContent = mensaje;
  mensajeFormulario.hidden = false;
}

// Ocultar advertencias anteriores
function limpiarErrorSprint() {
  mensajeFormulario.textContent = '';
  mensajeFormulario.hidden = true;
}


/* ==========================================
   HU-06: Validación del formulario de Sprints
   ========================================== */

// Obtener los campos del formulario
const inicioSprint = document.getElementById('sprint-inicio');
const finSprint = document.getElementById('sprint-fin');
// Cargar el proyecto cuando los campos de fecha ya están disponibles
if (proyectoId) obtenerEquipoProyecto();

function limitarFechasSprint() {
  if (!fechaInicioProyecto || !fechaFinProyecto) return;

  // Limitar ambos calendarios al periodo del proyecto
  inicioSprint.min = fechaInicioProyecto;
  inicioSprint.max = fechaFinProyecto;

  finSprint.min = fechaInicioProyecto;
  finSprint.max = fechaFinProyecto;
}


// Obtener los mensajes de error
const errorInicio = document.getElementById('error-inicio');
const errorFin = document.getElementById('error-fin');

// Validar las fechas del sprint
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


/* Validar que el sprint esté dentro de las fechas del proyecto */
function validarPeriodoProyecto() {
  // No permitir continuar si todavía no se cargaron las fechas
  if (!fechaInicioProyecto || !fechaFinProyecto) {
    mostrarErrorSprint(
      'No se pudieron comprobar las fechas del proyecto.'
    );
    return false;
  }

  // Comprobar la fecha de inicio
  if (inicioSprint.value < fechaInicioProyecto) {
    mostrarErrorSprint(
      `El sprint no puede comenzar antes del ${fechaInicioProyecto}.`
    );
    return false;
  }

  // Comprobar la fecha de finalización
  if (finSprint.value > fechaFinProyecto) {
    mostrarErrorSprint(
      `El sprint no puede terminar después del ${fechaFinProyecto}.`
    );
    return false;
  }

  return true;
}



inicioSprint.addEventListener('change', () => {
  limpiarErrorSprint();

  // Las fechas cambiaron: se necesita una nueva confirmación
  duracionAceptada = false;
  advertenciaDuracion.hidden = true;

  validarFechasSprint();
  calcularCapacidadSprint();
});

finSprint.addEventListener('change', () => {
  limpiarErrorSprint();

  // Las fechas cambiaron: se necesita una nueva confirmación
  duracionAceptada = false;
  advertenciaDuracion.hidden = true;

  validarFechasSprint();
  calcularCapacidadSprint();
});


// Validar al presionar "Crear sprint"

let capacidadCalculada = null;
let consultaCapacidadActual = 0;

// Calcular automáticamente la capacidad del equipo
async function calcularCapacidadSprint() {
  // Identificar esta consulta
  const numeroConsulta = ++consultaCapacidadActual;

  capacidadCalculada = null;

  const textoCapacidad = document.getElementById('capacidad-sprint');
  textoCapacidad.textContent = 'Calculando capacidad...';

  if (!equipoId || !validarFechasSprint()) {
    textoCapacidad.textContent = 'Pendiente de calcular';
    return;
  }

  // Guardar las fechas correspondientes a esta consulta
  const inicio = inicioSprint.value;
  const fin = finSprint.value;

  try {
    const datos = await api(
      `/capacidad/equipos/${equipoId}/capacidad?inicio=${inicio}&fin=${fin}`
    );

    // Ignorar respuestas de consultas anteriores
    if (numeroConsulta !== consultaCapacidadActual) {
      return;
    }

    capacidadCalculada = Number(datos.totalHoras);

    textoCapacidad.textContent =
      `${datos.totalHoras} horas disponibles`;

  } catch (error) {
    // Ignorar errores de consultas anteriores
    if (numeroConsulta !== consultaCapacidadActual) {
      return;
    }

    capacidadCalculada = null;
    console.error('Error al calcular capacidad:', error);

    textoCapacidad.textContent =
      'No se pudo calcular la capacidad';
  }
}



/* Verificar que el sprint tenga capacidad disponible */
function validarCapacidadSprint() {
  if (capacidadCalculada === null ||
      !Number.isFinite(capacidadCalculada) ||
      capacidadCalculada <= 0) {

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



 
/* Validar la duración recomendada del sprint */
function validarDuracionSprint() {
  const inicio = new Date(`${inicioSprint.value}T00:00:00Z`);
  const fin = new Date(`${finSprint.value}T00:00:00Z`);

  // Contar el primer y el último día
  const duracion = Math.round(
    (fin - inicio) / (1000 * 60 * 60 * 24)
  ) + 1;

  // Si la duración está dentro del rango, continuar
  if (duracion >= 7 && duracion <= 28) {
    advertenciaDuracion.hidden = true;
    return true;
  }

  // Si el usuario ya aceptó esta duración, continuar
  if (duracionAceptada) {
    advertenciaDuracion.hidden = true;
    return true;
  }

  // Mostrar la advertencia de AgileDesk
  textoAdvertenciaDuracion.textContent =
    `Este sprint dura ${duracion} días. ` +
    'La duración recomendada es de 7 a 28 días.';

  advertenciaDuracion.hidden = false;

  advertenciaDuracion.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  });

  // Detener el envío hasta que el usuario decida
  return false;
}


// Confirmación de duración fuera del rango recomendado
let duracionAceptada = false;

// Elementos de la advertencia de duración
const advertenciaDuracion = document.getElementById(
  'advertencia-duracion-sprint'
);

const textoAdvertenciaDuracion = document.getElementById(
  'texto-advertencia-duracion'
);

const botonContinuarDuracion = document.getElementById(
  'btn-continuar-duracion'
);

// El usuario acepta continuar con la duración seleccionada
botonContinuarDuracion.addEventListener('click', () => {
  duracionAceptada = true;
  advertenciaDuracion.hidden = true;

  // Reanudar el envío usando el mismo formulario
  formularioSprint.requestSubmit();
});

let guardandoSprint = false;
 //Enviar el formulario para crear un sprint
formularioSprint.addEventListener('submit', async (evento) => {
  // Evitar que la página se recargue
  evento.preventDefault();

  // Evitar que se procese el formulario dos veces
  if (guardandoSprint) {
    return;
  }

  // Comprobar que exista un proyecto activo
  if (!proyectoId) {
    alert('No se ha seleccionado un proyecto.');
    return;
  }

  // Validar las fechas
    if (!validarFechasSprint()) {
    mostrarErrorSprint('Revisa las fechas del sprint.');

    mensajeFormulario.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });

    return;
    }

    // Comprobar que el sprint esté dentro del periodo del proyecto
    if (!validarPeriodoProyecto()) {
    mensajeFormulario.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });

    return;
    }

  // Validar la duración
  if (!validarDuracionSprint()) {
    return;
  }

  // Obtener los datos del formulario
  const datosSprint = {
    proyectoId: Number(proyectoId),
    nombre: document.getElementById('sprint-nombre').value.trim(),
    objetivo: document.getElementById('sprint-objetivo').value.trim(),
    fechaInicio: inicioSprint.value,
    fechaFin: finSprint.value
  };

  const botonGuardar = document.getElementById('btn-guardar-sprint');
  const nombreSprint = document.getElementById('sprint-nombre');
  const objetivoSprint = document.getElementById('sprint-objetivo');

  try {
    guardandoSprint = true;
    // Evitar envíos repetidos
    botonGuardar.disabled = true;
    nombreSprint.disabled = true;
    objetivoSprint.disabled = true;
    inicioSprint.disabled = true;
    finSprint.disabled = true;

    
    // Recalcular la capacidad con el formulario bloqueado
    await calcularCapacidadSprint();

    // Detener el envío si no hay capacidad disponible
    if (!validarCapacidadSprint()) {
    return;
    }


    // Enviar los datos al backend
    await api('/sprints', {
    metodo: 'POST',
    cuerpo: datosSprint
    });


    // Limpiar el formulario después de crear el sprint
    formularioSprint.reset();
    capacidadCalculada = null;

    document.getElementById('capacidad-sprint').textContent =
    'Pendiente de calcular';


    dialogoSprint.close();

    // Mostrar mensaje de éxito en la página
    const mensajeSprints = document.getElementById('mensaje-sprints');

    mensajeSprints.textContent = '¡Sprint creado correctamente!';
    mensajeSprints.className = 'alerta alerta--exito';
    mensajeSprints.hidden = false;

    // Actualizar la lista de sprints
    await cargarSprints();



  } catch (error) {
    console.error('Error al crear sprint:', error);

    // Mostrar el mensaje enviado por el backend
    const mensaje =
        error.cuerpo?.mensaje ||
        'No se pudo crear el sprint. Inténtalo nuevamente.';

    mostrarErrorSprint(mensaje);

    // Llevar la advertencia a la vista del usuario
    mensajeFormulario.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
    });

  } finally {
    guardandoSprint = false;
    // Habilitar nuevamente el botón
    botonGuardar.disabled = false;
    nombreSprint.disabled = false;
    objetivoSprint.disabled = false;
    inicioSprint.disabled = false;
    finSprint.disabled = false;
  }
});


 //Consultar y mostrar los sprints del proyecto
async function cargarSprints() {
  const lista = document.getElementById('lista-sprints');

  if (!proyectoId) {
    lista.textContent = 'No hay un proyecto seleccionado.';
    return;
  }

  try {
    // Consultar los sprints guardados en PostgreSQL
    const datos = await api(`/sprints/proyectos/${proyectoId}`);

    // Limpiar el contenido anterior
    lista.replaceChildren();

    // Mostrar mensaje cuando todavía no existen sprints
    if (!datos.sprints || datos.sprints.length === 0) {
      const mensaje = document.createElement('p');
      mensaje.className = 'subtitulo-pagina';
      mensaje.textContent =
        'Todavía no hay sprints registrados en este proyecto.';

      lista.appendChild(mensaje);
      return;
    }

    // Crear una tarjeta para cada sprint
    datos.sprints.forEach((sprint) => {
      const tarjeta = document.createElement('article');
      tarjeta.className = 'tarjeta';

      const titulo = document.createElement('h3');
      titulo.textContent = sprint.nombre;

      const objetivo = document.createElement('p');
      objetivo.textContent = sprint.objetivo;

      
    const fechas = document.createElement('p');

        // Obtener las fechas del sprint
        const inicio = String(sprint.fecha_inicio).slice(0, 10);
        const fin = String(sprint.fecha_fin).slice(0, 10);

        // Convertirlas a un formato más fácil de leer
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

      // Mostrar la capacidad del sprint
        const capacidad = document.createElement('p');

        const horas = Number(sprint.capacidad_horas);

        capacidad.textContent =
        `Capacidad del equipo: ${horas.toLocaleString('es-MX')} horas`;

      // Mostrar el estado con una insignia de AgileDesk
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

      // Cabecera de la tarjeta: nombre y estado
        const cabecera = document.createElement('div');
        cabecera.className = 'equipo__cabecera';

        cabecera.append(titulo, estado);
        
        // Separar el objetivo de los datos del sprint
        const separador = document.createElement('hr');

        // Agregar los elementos en orden
        tarjeta.append(cabecera, objetivo, separador, fechas, capacidad);
      lista.appendChild(tarjeta);
    });

  } catch (error) {
    console.error('Error al cargar sprints:', error);
    lista.textContent = 'No se pudieron cargar los sprints.';
  }
}

// Cargar los sprints al abrir la página
cargarSprints();