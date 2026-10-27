/**
 * HU-35: Dashboard de KPIs.
 * Orquestar la carga de los indicadores y pintar el estado correcto:
 *   - Mostrar esqueletos mientras se consulta.
 *   - Mostrar el aviso de estado vacío si el proyecto no tiene datos.
 *   - Mostrar "—" en días restantes si no hay sprint activo.
 *   - Mostrar error solo en el KPI que falló y cargar los demás.
 */
import { api } from '../core/api.js'; // Ruta relativa corregida
import { montarBarraSuperior } from '../core/layout.js'; // Ruta relativa corregida
import { tarjetaCarga, tarjetaError, tarjetaValor } from '../core/ui.js'; // Ruta relativa corregida
import { tonoAvance, tonoImpedimentos, tonoDesviacion } from '../core/semaforo.js'; // Ruta relativa corregida
import { pluralizar, escaparHtml } from '../core/utils.js'; // Ruta relativa corregida
import { inicializarNotificaciones } from '../componentes/notificaciones.js'; // Ruta relativa corregida

// Insertar la barra superior de navegación. Esto también inyecta <div id="notificaciones-root"></div>
montarBarraSuperior();

/**
 * HU-24: Montar la campana de notificaciones en la barra superior.
 * Se busca el contenedor creado por layout.js y se inicializa la campana.
 * @returns {void}
 */
function montarNotificaciones() {
  try {
    const raiz = document.getElementById('notificaciones-root');
    if (!raiz) {
      console.warn('[dashboard] Contenedor de notificaciones no encontrado.');
      return;
    }
    inicializarNotificaciones({
      contenedor: raiz,
      socket: null, // Sockets deshabilitados en esta etapa (modo demo)
    });
  } catch (error) {
    console.error('[dashboard] No se pudieron montar las notificaciones:', error);
  }
}

montarNotificaciones();

// Referenciar los elementos de la página que se actualizan
const grilla = document.getElementById('kpi-grilla');
const avisoVacio = document.getElementById('aviso-vacio');
const btnActualizar = document.getElementById('btn-actualizar');

// Leer los parámetros de la URL: ?proyecto=ID y ?escenario=nombre (solo pruebas)
const params = new URLSearchParams(location.search);
const proyectoId = params.get('proyecto') || null;
const escenario = params.get('escenario');   // Simular en el navegador

const tituloPagina = document.getElementById('dashboard-titulo');
const subtituloPagina = document.getElementById('dashboard-subtitulo');
const infoProyecto = document.getElementById('info-proyecto');
const dodTexto = document.getElementById('dod-texto');

/**
 * Declarar los 4 KPIs en el orden en que se muestran.
 * Relacionar cada "id" con la clave que devuelve el backend.
 */
const KPIS = [
  { id: 'avance',        etiqueta: 'Avance global',        claveIcono: 'avance' },
  { id: 'diasRestantes', etiqueta: 'Días restantes',        claveIcono: 'dias' },
  { id: 'impedimentos',  etiqueta: 'Impedimentos abiertos', claveIcono: 'impedimentos' },
  { id: 'desviacion',    etiqueta: 'Desviación acumulada',  claveIcono: 'desviacion' },
];

/**
 * Modal de detalles de los KPI
 */ 
const modalKpi = document.getElementById('dialogo-detalle-kpi');
const tituloModalKpi = document.getElementById('detalle-kpi-titulo');
const descripcionModalKpi = document.getElementById('detalle-kpi-descripcion');
const contenidoModalKpi = document.getElementById('detalle-kpi-contenido');
const enlaceModalKpi = document.getElementById('detalle-kpi-enlace');
const cerrarModalKpi = document.getElementById('detalle-kpi-cerrar');

function abrirDetalleKpi(id) {
  const indicador = KPIS.find(kpi => kpi.id === id);

  if (!indicador || !modalKpi) return;

  tituloModalKpi.textContent = indicador.etiqueta;

  const descripciones = {
    avance: 'Muestra qué porcentaje de las tareas del proyecto se ha completado.',
    diasRestantes: 'Indica cuántos días faltan para finalizar el sprint activo.',
    impedimentos: 'Muestra los obstáculos pendientes que pueden afectar el trabajo del equipo.',
    desviacion: 'Compara las horas reales de trabajo con las horas estimadas.'
  };

  descripcionModalKpi.textContent = descripciones[id] || 'Información del indicador.';
  contenidoModalKpi.textContent = '';
  
  const k = datosKpiActuales[id];

  if (id === 'avance' && k) {
    const porcentaje = Number(k.valor);
    const hechas = Number(k.hechas);
    const total = Number(k.total);

    contenidoModalKpi.textContent =
      `Avance actual: ${Number.isFinite(porcentaje) ? porcentaje : 'No disponible'}%\n` +
      `Tareas completadas: ${Number.isFinite(hechas) ? hechas : 'No disponible'}\n` +
      `Total de tareas: ${Number.isFinite(total) ? total : 'No disponible'}`;
  }
  
  if (id === 'diasRestantes' && k) {
    if (k.valor === null || k.valor === undefined) {
      contenidoModalKpi.textContent =
        'No hay un sprint activo en este momento.';
    } else {
      const dias = Number(k.valor);

      contenidoModalKpi.textContent =
        `Días restantes: ${Number.isFinite(dias) ? dias : 'No disponible'}\n` +
        'Este indicador muestra el tiempo que falta para cerrar el sprint activo.';
    }
  }

  if (id === 'impedimentos' && k) {
    const total = Number(k.valor);
    const criticos = Number(k.criticos);

    if (total === 0) {
      contenidoModalKpi.textContent =
        'No hay impedimentos abiertos en este momento.';
    } else {
      contenidoModalKpi.textContent =
        `Impedimentos abiertos: ${Number.isFinite(total) ? total : 'No disponible'}\n` +
        `Impedimentos críticos: ${Number.isFinite(criticos) ? criticos : 'No disponible'}\n` +
        'Los impedimentos son obstáculos que pueden dificultar el avance del equipo.';
    }
  }
  
  if (id === 'desviacion' && k) {
    const diferencia = Number(k.valor);
    const reales = Number(k.real);
    const estimadas = Number(k.estimado);

    const estado = diferencia < 0
      ? 'Por debajo de lo estimado'
      : diferencia === 0
        ? 'Dentro de lo estimado'
        : 'Por encima de lo estimado';

    contenidoModalKpi.textContent =
      `Desviación acumulada: ${Number.isFinite(diferencia) ? `${diferencia > 0 ? '+' : ''}${diferencia} h` : 'No disponible'}\n` +
      `Horas reales: ${Number.isFinite(reales) ? reales : 'No disponible'} h\n` +
      `Horas estimadas: ${Number.isFinite(estimadas) ? estimadas : 'No disponible'} h\n` +
      `Estado: ${estado}`;
  }

  enlaceModalKpi.hidden = true;

  modalKpi.showModal();
}

cerrarModalKpi?.addEventListener('click', () => {
  modalKpi.close();
});


/* ====================================================================
 * DATOS SIMULADOS (solo para pruebas)
 * Activar agregando ?escenario=... a la URL.
 * Imitar el formato del backend: { vacio, kpis: { ... } }.
 * Representar un KPI con fallo mediante { error: true }.
 * ==================================================================== */
const SIMULACIONES = {
  // Simular un proyecto con datos y un sprint activo
  normal: {
    vacio: false,
    kpis: {
      avance:        { valor: 74, hechas: 37, total: 50 },
      diasRestantes: { valor: 4 },
      impedimentos:  { valor: 2, criticos: 1 },
      desviacion:    { valor: -8, estimado: 160, real: 152 },
    },
  },
  // Simular un proyecto sin sprint activo (días restantes en null)
  sinsprint: {
    vacio: false,
    kpis: {
      avance:        { valor: 32, hechas: 8, total: 25 },
      diasRestantes: { valor: null },
      impedimentos:  { valor: 0, criticos: 0 },
      desviacion:    { valor: 3, estimado: 80, real: 83 },
    },
  },
  // Simular un proyecto nuevo sin información
  vacio: { vacio: true, kpis: {} },
  // Simular que falla el cálculo de un solo KPI (impedimentos)
  parcial: {
    vacio: false,
    kpis: {
      avance:        { valor: 74, hechas: 37, total: 50 },
      diasRestantes: { valor: 4 },
      impedimentos:  { error: true },
      desviacion:    { valor: 14, estimado: 100, real: 114 },
    },
  },
};

/**
 * Pausar la ejecución durante un tiempo.
 * @param {number} ms - Milisegundos a esperar.
 * @returns {Promise<void>}
 */
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Resolver la respuesta simulada de un escenario, con latencia artificial.
 * Lanzar un error en el escenario "falla" para simular la caída total del servidor.
 * Retrasar 1.8 s el escenario "lento" para observar los esqueletos.
 *
 * @param {string} nombre - Escenario: normal, sinsprint, vacio, parcial, lento o falla.
 * @returns {Promise<Object>} Respuesta simulada.
 */
async function simular(nombre) {
  if (nombre === 'lento') { await esperar(1800); return SIMULACIONES.normal; }
  await esperar(450);
  if (nombre === 'falla') throw new Error('Simulación: servidor no disponible');
  return SIMULACIONES[nombre] || SIMULACIONES.normal;
}

/**
 * Obtener los datos del dashboard:
 *   - Simular en el navegador si hay ?escenario=... (no usa el servidor).
 *   - Consultar el servidor en caso contrario; con ?demo=... pedirle un escenario
 *     de ejemplo (el servidor solo lo respeta en modo demo).
 *
 * @param {AbortSignal} signal - Señal para cancelar la consulta.
 * @returns {Promise<{vacio: boolean, kpis: Object}>}
 */
function obtenerDatos(signal) {
  if (escenario) return simular(escenario);
  // Si no hay proyecto seleccionado válido, devolvemos estado vacío controlado sin error
  if (!proyectoId || proyectoId === 'null') {
    return Promise.resolve({ vacio: true, kpis: {} });
  }
  return api(`/metricas/proyectos/${proyectoId}/dashboard`, { signal });
}

/* ====================================================================
 * REGLAS DE PRESENTACIÓN
 * Decidir el tono, el texto y la unidad de cada KPI según su valor.
 * Cada función recibe (k = datos del KPI, meta = etiqueta e icono).
 * ==================================================================== */
const constructores = {
  /** Pintar el avance con barra de progreso y conteo de tareas. */
  avance(k, meta) {
    return tarjetaValor({ ...meta, tono: tonoAvance(k.valor), valor: k.valor, unidad: '%',
      progreso: k.valor, pista: `${k.hechas} de ${k.total} tareas completadas` });
  },

  /** Pintar los días restantes; mostrar "—" cuando no hay sprint activo (valor null). */
  diasRestantes(k, meta) {
    if (k.valor === null || k.valor === undefined) {
      return tarjetaValor({ ...meta, tono: 'neutro', valor: '—', pista: 'No hay un sprint activo' });
    }
    return tarjetaValor({ ...meta, tono: 'info', valor: k.valor,
      unidad: pluralizar(k.valor, 'día', 'días'), pista: 'Para cerrar el sprint activo' });
  },

  /** Pintar los impedimentos abiertos e indicar cuántos son críticos. */
  impedimentos(k, meta) {
    const pista = k.valor === 0 ? 'Sin impedimentos abiertos'
      : k.criticos > 0 ? `${k.criticos} ${pluralizar(k.criticos, 'crítico pendiente', 'críticos pendientes')}`
      : 'Ninguno crítico';
    return tarjetaValor({ ...meta, tono: tonoImpedimentos(k.valor, k.criticos), valor: k.valor, pista });
  },
  

  /** Pintar la desviación (horas reales − estimadas) con signo explícito. */
  desviacion(k, meta) {
    const signo = k.valor > 0 ? '+' : '';
    const estado = k.valor < 0 ? 'Bajo presupuesto' : k.valor === 0 ? 'Dentro de lo estimado' : 'Sobre presupuesto';
    return tarjetaValor({ ...meta, tono: tonoDesviacion(k.valor, k.estimado), valor: `${signo}${k.valor}`,
      unidad: 'h', pista: `${estado} · ${k.real} h reales de ${k.estimado} h` });
  },
};

/* ====================================================================
 * RENDERIZADO
 * ==================================================================== */

/**
 * Mostrar 4 tarjetas en estado de carga y ocultar el aviso de estado vacío.
 * @returns {void}
 */
function pintarCarga() {
  if (avisoVacio) avisoVacio.hidden = true;
  if (grilla) {
    grilla.hidden = false;
    grilla.innerHTML = KPIS.map(k => tarjetaCarga(k.etiqueta, k.claveIcono)).join('');
  }
}

let datosKpiActuales = {};

/**
 * Pintar la respuesta del servidor.
 * Mostrar el aviso de estado vacío cuando datos.vacio es true.
 * Aislar los errores: pintar una tarjeta de error solo en el KPI afectado.
 *
 * @param {{vacio: boolean, kpis: Object}} datos - Respuesta del backend.
 * @returns {void}
 */

function pintarDatos(datos) {
  if (!grilla) return;
  // Guardar los KPI del proyecto seleccionado
  datosKpiActuales = datos.vacio ? {} : (datos.kpis || {});

  // Mostrar un mensaje diferente cuando no hay proyecto seleccionado
  if (!proyectoId) {
    const titulo = avisoVacio?.querySelector('.aviso__titulo');
    const texto = avisoVacio?.querySelector('.aviso__texto');

    if (titulo) titulo.textContent = 'Selecciona un proyecto';
    if (texto) texto.textContent =
      'Haz clic en "Ver" en cualquiera de los proyectos para consultar sus indicadores.';

    // Ocultar el botón de ir al backlog
    const enlace = avisoVacio?.querySelector('a');
    if (enlace) enlace.hidden = true;
  }

  // Mostrar el mensaje de proyecto nuevo y ocultar la grilla
  if (datos.vacio) {
    grilla.hidden = true;
    grilla.innerHTML = '';
    if (avisoVacio) avisoVacio.hidden = false;
    return;
  }

  if (avisoVacio) avisoVacio.hidden = true;
  grilla.hidden = false;
  grilla.innerHTML = KPIS.map(meta => {
    const k = datos.kpis?.[meta.id];
    // Pintar error si el KPI falta o viene marcado con error
    if (!k || k.error) return tarjetaError(meta.etiqueta, meta.claveIcono, meta.id);
    // Capturar fallos inesperados al construir la tarjeta para no afectar a las demás
    
    try {
      const tarjeta = constructores[meta.id](k, meta);

      return tarjeta.replace(
        '<article ',
        `<article data-kpi="${meta.id}" tabindex="0" role="button" aria-haspopup="dialog" `
      );
    } catch {
      return tarjetaError(meta.etiqueta, meta.claveIcono, meta.id);
    }

  }).join('');
}

/* Abrir el modal al seleccionar una tarjeta KPI */
grilla?.addEventListener('click', (evento) => {
  const tarjeta = evento.target.closest('[data-kpi]');
  if (!tarjeta) return;

  abrirDetalleKpi(tarjeta.dataset.kpi);
});

/* Permitir abrir el modal con Enter o Espacio */
grilla?.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter' && evento.key !== ' ') return;

  const tarjeta = evento.target.closest('[data-kpi]');
  if (!tarjeta) return;

  evento.preventDefault();
  abrirDetalleKpi(tarjeta.dataset.kpi);
});


function pintarInfoProyecto(proyecto) {
  if (!proyecto) return;
  
  // Cambiar el título y la visión
  if (tituloPagina) tituloPagina.textContent = proyecto.nombre;
  if (subtituloPagina) subtituloPagina.textContent = proyecto.vision;
  
  // Mostrar el Definition of Done
  if (infoProyecto && dodTexto && proyecto.definition_of_done) {
    dodTexto.textContent = proyecto.definition_of_done;
    infoProyecto.hidden = false;
  }
}

/**
 * Pintar las 4 tarjetas en error cuando la petición completa falla
 * (por ejemplo, servidor caído, sin conexión o sesión expirada).
 * @returns {void}
 */
function pintarFalloTotal() {
  if (avisoVacio) avisoVacio.hidden = true;
  if (grilla) {
    grilla.hidden = false;
    // Si no hay proyecto seleccionado, en vez de error total mostramos vacío amigable
    if (!proyectoId || proyectoId === 'null') {
      grilla.hidden = true;
      if (avisoVacio) avisoVacio.hidden = false;
      return;
    }
    grilla.innerHTML = KPIS.map(k => tarjetaError(k.etiqueta, k.claveIcono, k.id)).join('');
  }
}

/* ====================================================================
 * CARGA Y EVENTOS
 * ==================================================================== */

// Guardar el controlador de la petición en curso para poder cancelarla
let controlador;

/**
 * Cargar los KPIs: mostrar esqueletos, consultar y pintar el resultado.
 * Cancelar la petición anterior si el usuario vuelve a pedir datos.
 * Deshabilitar el botón "Actualizar" mientras se consulta.
 *
 * @returns {Promise<void>}
 */
async function cargar() {
   if (!proyectoId) {
    pintarDatos({ vacio: true, kpis: {} });
    return;
  }
  controlador?.abort();
  controlador = new AbortController();
  controlador?.abort();
  controlador = new AbortController();
  if (btnActualizar) btnActualizar.disabled = true;
  pintarCarga();
  try {
    pintarDatos(await obtenerDatos(controlador.signal));
  } catch (e) {
    // Ignorar las cancelaciones voluntarias; tratar el resto como fallo total
    if (e.name !== 'AbortError') pintarFalloTotal();
  } finally {
    if (btnActualizar) btnActualizar.disabled = false;
  }
}

// Recargar al pulsar "Actualizar"
if (btnActualizar) {
  btnActualizar.addEventListener('click', cargar);
}

// Recargar al pulsar "Reintentar" en cualquier tarjeta (delegación de eventos)
if (grilla) {
  grilla.addEventListener('click', (e) => { 
    if (e.target.closest('[data-reintentar]')) cargar(); 
  });
}

// Cargar los datos al abrir la página
cargar();

/* ====================================================================
 * HU-01: GESTIONAR PROYECTOS DESDE EL DASHBOARD
 *   - Listar los proyectos del usuario (activos o archivados).
 *   - Mostrar "Nuevo proyecto" y "Editar" solo si el usuario es administrador.
 *   - Archivar con confirmación; avisar si hay un sprint activo.
 *   - Entregar a pintarInfoProyecto los datos del proyecto seleccionado.
 * ==================================================================== */

const $ = (id) => document.getElementById(id);

/** Dar formato legible a una fecha "AAAA-MM-DD". */
function formatearFecha(texto) {
  if (!texto) return '—';
  return new Date(`${texto}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Iniciar la sección de proyectos del Dashboard.
 * @param {Object} opciones
 * @param {number|string} opciones.proyectoId - Proyecto seleccionado actualmente.
 * @param {(proyecto: Object) => void} opciones.alCargarProyecto - Recibe el proyecto seleccionado.
 * @returns {Promise<void>}
 */
async function iniciarProyectos({ proyectoId, alCargarProyecto }) {
  const lista = $('proyectos-lista');
  const error = $('proyectos-error');
  const chkArchivados = $('ver-archivados');
  const btnNuevo = $('btn-nuevo-proyecto');
  const dialogo = $('dialogo-archivar-proyecto');
  if (!lista) return;

  const idActivo = Number(proyectoId);
  let pendienteArchivar = null;

  const mostrarError = (texto) => { error.textContent = texto; error.hidden = !texto; };

  /** Pintar tarjetas de carga mientras se consulta. */
  function pintarCarga() {
    lista.innerHTML = '<div class="tarjeta esqueleto proyecto__carga"></div><div class="tarjeta esqueleto proyecto__carga"></div>';
  }

  /** Pintar el estado vacío según el filtro. */
  function pintarVacio(archivados) {
    // CORREGIDO: Ahora cualquier usuario puede crear un proyecto, por lo que se muestra la opción a todos.
    const crear = !archivados
      ? '<a class="boton boton--primario" href="/pages/configuracion-proyecto.html">Crear el primer proyecto</a>' : '';
    lista.innerHTML = `<div class="aviso aviso--vacio proyectos__vacio">
      <h3 class="aviso__titulo">${archivados ? 'No hay proyectos archivados' : 'Aún no hay proyectos'}</h3>
      <p class="aviso__texto">${archivados ? 'Los proyectos que archives aparecerán aquí con todo su historial.'
        : 'Crea un proyecto para empezar a organizar el trabajo del equipo.'}</p>${crear}</div>`;
  }

  /** Construir la tarjeta de un proyecto. */
  function tarjeta(p) {
    const id = encodeURIComponent(p.id);
    const insignias = [
      p.archivado ? '<span class="insignia insignia--neutro">Archivado</span>' : '',
      p.sprint_activo ? '<span class="insignia insignia--exito">Sprint activo</span>' : '',
    ].join('');
    
    const acciones = [
      // Ver siempre está disponible para los proyectos de la lista.
      `<a class="boton boton--secundario boton--pequeno"
          href="/pages/dashboard.html?proyecto=${id}"
          data-ver="${id}">Ver</a>`,

      // Editar aparece siempre, pero se deshabilita sin permiso.
      p.puede_gestionar
        ? `<a class="boton boton--secundario boton--pequeno"
              href="/pages/configuracion-proyecto.html?id=${id}">Editar</a>`
        : `<button class="boton boton--secundario boton--pequeno"
              type="button" disabled
              title="No tienes permiso para editar este proyecto">Editar</button>`,

      // Archivar aparece siempre, pero se deshabilita sin permiso
      // o cuando el proyecto ya está archivado.
      `<button class="boton boton--secundario boton--pequeno"
          type="button"
          ${p.puede_gestionar && !p.archivado
            ? `data-archivar="${id}" data-nombre="${escaparHtml(p.nombre)}"`
            : 'disabled title="No puedes archivar este proyecto"'}
          >Archivar</button>`
    ].join('');

    return `<article class="tarjeta proyecto${p.id === idActivo ? ' proyecto--activo' : ''}">
      <div class="proyecto__cabecera"><h3 class="proyecto__nombre">${escaparHtml(p.nombre)}</h3><div class="proyecto__insignias">${insignias}</div></div>
      <p class="proyecto__equipo">${escaparHtml(p.equipo_nombre)}</p>
      <p class="proyecto__vision">${escaparHtml(p.vision)}</p>
      <p class="proyecto__fechas">${formatearFecha(p.fecha_inicio)} – ${formatearFecha(p.fecha_fin)}</p>
      <div class="proyecto__acciones">${acciones}</div></article>`;
  }

  /** Consultar y pintar la lista. */
  async function cargarLista() {
    const archivados = chkArchivados.checked;
    mostrarError('');
    pintarCarga();
    try {
      const datos = await api(`/proyectos${archivados ? '?archivados=true' : ''}`);
      
      // Permitir que el botón de nuevo proyecto esté visible siempre para que cualquier usuario pueda crear uno
      btnNuevo.hidden = false;

    if (!datos.proyectos.length) {
      pintarVacio(archivados);

      // Si no tiene proyectos y no hay uno seleccionado,
      // mostrar un mensaje apropiado en el Dashboard.
      if (!archivados && !proyectoId && avisoVacio) {
        const titulo = avisoVacio.querySelector('.aviso__titulo');
        const texto = avisoVacio.querySelector('.aviso__texto');

        if (titulo) titulo.textContent = 'Aún no tienes proyectos';
        if (texto) texto.textContent =
          'Crea tu primer proyecto para comenzar a consultar sus indicadores.';
      }

  return;
}      lista.innerHTML = datos.proyectos.map(tarjeta).join('');
    } catch {
      lista.innerHTML = '';
      mostrarError('No se pudieron cargar los proyectos.');
      lista.innerHTML = '<button class="boton boton--secundario" type="button" data-reintentar-proyectos>Reintentar</button>';
    }
  }

  /** Cargar el proyecto seleccionado y entregárselo al dashboard. */
  async function cargarSeleccionado() {
    if (!idActivo || Number.isNaN(idActivo)) return;
    try {
      const datos = await api(`/proyectos/${encodeURIComponent(idActivo)}`);
      if (datos?.proyecto) {
        alCargarProyecto?.(datos.proyecto);
      }
    } catch (e) {
      if (e.estado === 404 || e.estado === 403) {
        // En lugar de texto agresivo, lo manejamos limpiando el proyecto activo si no existe
        localStorage.removeItem('proyectoActivo');
      }
    }
  }

  // ---------- Eventos ----------
  chkArchivados.addEventListener('change', cargarLista);

  lista.addEventListener('click', (e) => {
    const ver = e.target.closest('[data-ver]');
    if (ver) localStorage.setItem('proyectoActivo', decodeURIComponent(ver.dataset.ver));
    if (e.target.closest('[data-reintentar-proyectos]')) cargarLista();
    const archivar = e.target.closest('[data-archivar]');
    if (archivar) {
      pendienteArchivar = { id: archivar.dataset.archivar, nombre: archivar.dataset.nombre };
      $('archivar-proyecto-nombre').textContent = pendienteArchivar.nombre;
      dialogo.showModal();
    }
  });

  $('archivar-proyecto-cancelar').addEventListener('click', () => dialogo.close());
  $('archivar-proyecto-confirmar').addEventListener('click', async () => {
    dialogo.close();
    if (!pendienteArchivar) return;
    const { id, nombre } = pendienteArchivar;
    try {
      await api(`/proyectos/${id}/archivar`, { metodo: 'POST' });
      if (Number(decodeURIComponent(id)) === idActivo) localStorage.removeItem('proyectoActivo');
      await cargarLista();
    } catch (e) {
      mostrarError(e.estado === 409
        ? `«${nombre}» tiene un sprint activo. Ciérralo desde Sprints y vuelve a intentarlo.`
        : e.estado === 403 ? 'Solo un administrador puede archivar proyectos.'
        : 'No se pudo archivar el proyecto. Inténtalo de nuevo.');
    }
  });

  await Promise.all([cargarLista(), cargarSeleccionado()]);
}

// HU-01: pintar la lista de proyectos y la información (visión y DoD) del proyecto seleccionado
iniciarProyectos({ proyectoId, alCargarProyecto: pintarInfoProyecto });