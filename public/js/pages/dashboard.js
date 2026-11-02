/**
 * @file dashboard.js
 * @description HU-35: Dashboard de KPIs.
 * Orquestar la carga de los indicadores y pintar el estado correcto:
 *   - Mostrar esqueletos mientras se consulta.
 *   - Mostrar el aviso de estado vacío si el proyecto no tiene datos.
 *   - Mostrar "—" en días restantes si no hay sprint activo.
 *   - Mostrar error solo en el KPI que falló y cargar los demás.
 *   - Permitir navegar a cada sección de las métricas/calendario.
 * @author Dana
 */

import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { tarjetaCarga, tarjetaError, tarjetaValor } from '../core/ui.js';
import { tonoAvance, tonoImpedimentos, tonoDesviacion } from '../core/semaforo.js';
import { pluralizar, escaparHtml } from '../core/utils.js';
import { inicializarNotificaciones } from '../componentes/notificaciones.js';

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

// Leer los parámetros de la URL
const params = new URLSearchParams(location.search);
const proyectoId = params.get('proyecto') || null;

const tituloPagina = document.getElementById('dashboard-titulo');
const subtituloPagina = document.getElementById('dashboard-subtitulo');
const infoProyecto = document.getElementById('info-proyecto');
const dodTexto = document.getElementById('dod-texto');

// Variables de estado del dashboard
let estadoEsScrumMaster = false;
let datosKpiActuales = {};

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
 * Obtener los datos del dashboard.
 * @param {AbortSignal} signal - Señal para cancelar la consulta.
 * @returns {Promise<{vacio: boolean, kpis: Object}>}
 */
function obtenerDatos(signal) {
  if (!proyectoId || proyectoId === 'null') {
    return Promise.resolve({ vacio: true, kpis: {} });
  }
  return api(`/metricas/proyectos/${proyectoId}/dashboard`, { signal });
}

/* ====================================================================
 * REGLAS DE PRESENTACIÓN
 * ==================================================================== */
const constructores = {
  avance(k, meta) {
    return tarjetaValor({ ...meta, tono: tonoAvance(k.valor), valor: k.valor, unidad: '%',
      progreso: k.valor, pista: `${k.hechas} de ${k.total} tareas completadas` });
  },

  diasRestantes(k, meta) {
    if (k.valor === null || k.valor === undefined) {
      return tarjetaValor({ ...meta, tono: 'neutro', valor: '—', pista: 'No hay un sprint activo' });
    }
    return tarjetaValor({ ...meta, tono: 'info', valor: k.valor,
      unidad: pluralizar(k.valor, 'día', 'días'), pista: 'Para cerrar el sprint activo' });
  },

  impedimentos(k, meta) {
    // k contiene { mios, todos }. Leemos el objeto de todos para el dashboard general
    const data = k.todos;
    const pista = data.valor === 0 ? 'Sin impedimentos abiertos'
      : data.criticos > 0 ? `${data.criticos} ${pluralizar(data.criticos, 'crítico pendiente', 'críticos pendientes')}`
      : 'Ninguno crítico';
    return tarjetaValor({ ...meta, tono: tonoImpedimentos(data.valor, data.criticos), valor: data.valor, pista });
  },

  desviacion(k, meta) {
    const signo = k.valor > 0 ? '+' : '';
    // HU-33: Si supera umbral, forzamos advertencia o peligro
    const estado = k.superaUmbral ? 'Alerta por desviación' : k.valor < 0 ? 'Bajo presupuesto' : k.valor === 0 ? 'Dentro de lo estimado' : 'Sobre presupuesto';
    const tonoFuerza = k.superaUmbral ? 'peligro' : tonoDesviacion(k.valor, k.estimado);
    
    return tarjetaValor({ ...meta, tono: tonoFuerza, valor: `${signo}${k.valor}`,
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

/**
 * Pintar la respuesta del servidor.
 * Mostrar el aviso de estado vacío cuando datos.vacio es true.
 * @param {{vacio: boolean, kpis: Object, esScrumMaster: boolean}} datos - Respuesta del backend.
 * @returns {void}
 */
function pintarDatos(datos) {
  if (!grilla) return;
  datosKpiActuales = datos.vacio ? {} : (datos.kpis || {});
  estadoEsScrumMaster = datos.esScrumMaster || false;

  // Mostrar un mensaje diferente cuando no hay proyecto seleccionado
  if (!proyectoId) {
    const titulo = avisoVacio?.querySelector('.aviso__titulo');
    const texto = avisoVacio?.querySelector('.aviso__texto');
    if (titulo) titulo.textContent = 'Selecciona un proyecto';
    if (texto) texto.textContent = 'Haz clic en "Ver" en cualquiera de los proyectos para consultar sus indicadores.';
    const enlace = avisoVacio?.querySelector('a');
    if (enlace) enlace.hidden = true;
  }

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
    if (!k || k.error) return tarjetaError(meta.etiqueta, meta.claveIcono, meta.id);
    
    try {
      const tarjeta = constructores[meta.id](k, meta);
      // Volver la tarjeta clicable y accesible para el ruteo manual
      return tarjeta.replace(
        '<article ',
        `<article data-kpi="${meta.id}" style="cursor:pointer;" tabindex="0" role="link" `
      );
    } catch {
      return tarjetaError(meta.etiqueta, meta.claveIcono, meta.id);
    }
  }).join('');
}

/* Redirecciones dinámicas de los KPIs */
grilla?.addEventListener('click', (evento) => {
  const tarjeta = evento.target.closest('[data-kpi]');
  if (!tarjeta) return;
  const id = tarjeta.dataset.kpi;
  const rutas = {
     avance: `/pages/metricas.html?proyecto=${proyectoId}#avance`,
     diasRestantes: `/pages/calendario.html?proyecto=${proyectoId}`,
     desviacion: `/pages/metricas.html?proyecto=${proyectoId}#burndown`,
     impedimentos: `/pages/impedimentos.html?proyecto=${proyectoId}`
  };
  
  if (rutas[id]) window.location.href = rutas[id];
});

/* Permitir clic con teclado en la grilla */
grilla?.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter' && evento.key !== ' ') return;
  const tarjeta = evento.target.closest('[data-kpi]');
  if (!tarjeta) return;
  evento.preventDefault();
  tarjeta.click();
});

function pintarInfoProyecto(proyecto) {
  if (!proyecto) return;
  if (tituloPagina) tituloPagina.textContent = proyecto.nombre;
  if (subtituloPagina) subtituloPagina.textContent = proyecto.vision;
  if (infoProyecto && dodTexto && proyecto.definition_of_done) {
    dodTexto.textContent = proyecto.definition_of_done;
    infoProyecto.hidden = false;
  }
}

/**
 * Pintar las 4 tarjetas en error cuando la petición completa falla
 * @returns {void}
 */
function pintarFalloTotal() {
  if (avisoVacio) avisoVacio.hidden = true;
  if (grilla) {
    grilla.hidden = false;
    if (!proyectoId || proyectoId === 'null') {
      grilla.hidden = true;
      if (avisoVacio) avisoVacio.hidden = false;
      return;
    }
    grilla.innerHTML = KPIS.map(k => tarjetaError(k.etiqueta, k.claveIcono, k.id)).join('');
  }
}

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
  if (btnActualizar) btnActualizar.disabled = true;
  pintarCarga();
  try {
    pintarDatos(await obtenerDatos(controlador.signal));
  } catch (e) {
    if (e.name !== 'AbortError') pintarFalloTotal();
  } finally {
    if (btnActualizar) btnActualizar.disabled = false;
  }
}

if (btnActualizar) {
  btnActualizar.addEventListener('click', cargar);
}

// Recargar al pulsar "Reintentar" en cualquier tarjeta
if (grilla) {
  grilla.addEventListener('click', (e) => { 
    if (e.target.closest('[data-reintentar]')) cargar(); 
  });
}

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

  function pintarVacio(archivados) {
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
      `<a class="boton boton--secundario boton--pequeno"
          href="/pages/dashboard.html?proyecto=${id}"
          data-ver="${id}">Ver</a>`,

      p.puede_gestionar
        ? `<a class="boton boton--secundario boton--pequeno"
              href="/pages/configuracion-proyecto.html?id=${id}">Editar</a>`
        : `<button class="boton boton--secundario boton--pequeno"
              type="button" disabled
              title="No tienes permiso para editar este proyecto">Editar</button>`,

      `<button class="boton boton--secundario boton--pequeno"
          type="button"
          ${p.puede_gestionar && !p.archivado
            ? `data-archivar="${id}" data-nombre="${escaparHtml(p.nombre)}"`
            : 'disabled title="No puedes archivar este proyecto"'}
          >Archivar</button>`
    ].join('');

    return `<article class="tarjeta proyecto${p.id === idActivo ? ' proyecto--activo' : ''}" style="cursor: pointer;">
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
      btnNuevo.hidden = false;

      if (!datos.proyectos.length) {
        pintarVacio(archivados);
        if (!archivados && !proyectoId && avisoVacio) {
          const titulo = avisoVacio.querySelector('.aviso__titulo');
          const texto = avisoVacio.querySelector('.aviso__texto');
          if (titulo) titulo.textContent = 'Aún no tienes proyectos';
          if (texto) texto.textContent = 'Crea tu primer proyecto para comenzar a consultar sus indicadores.';
        }
        return;
      }
      lista.innerHTML = datos.proyectos.map(tarjeta).join('');
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
        localStorage.removeItem('proyectoActivo');
      }
    }
  }

  // ---------- Eventos ----------
  chkArchivados.addEventListener('change', cargarLista);

  lista.addEventListener('click', (e) => {
    const btnVer = e.target.closest('[data-ver]');
    const tarjeta = e.target.closest('.proyecto');
    
    // Si cliqueó la tarjeta en general (no un botón secundario)
    if (tarjeta && !e.target.closest('button, a')) {
      const enlaceBase = tarjeta.querySelector('[data-ver]');
      if (enlaceBase) {
        localStorage.setItem('proyectoActivo', decodeURIComponent(enlaceBase.dataset.ver));
        window.location.href = enlaceBase.href;
      }
    } else if (btnVer) {
      localStorage.setItem('proyectoActivo', decodeURIComponent(btnVer.dataset.ver));
    }
    
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

iniciarProyectos({ proyectoId, alCargarProyecto: pintarInfoProyecto });