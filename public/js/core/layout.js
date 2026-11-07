/**
 * @file layout.js
 * @description Construir e insertar la barra superior de navegación en <header id="barra-superior">.
 * Reutilizar este módulo en todas las páginas para mantener un menú único.
 * Incluye la campana de notificaciones (HU-24) y carga su hoja de estilos de forma global.
 * 
 * @author Citlaly Morales Viveros
 */
import { escaparHtml, iniciales } from './utils.js';
import './permisos-ui.js';

/** Ruta pública de la hoja de estilos de la campana de notificaciones (HU-24). */
const RUTA_CSS_NOTIFICACIONES = '/css/componentes/notificaciones.css';

/** Ruta (relativa a este archivo) del componente de la campana. */
const RUTA_MODULO_NOTIFICACIONES = '../componentes/notificaciones.js';

/**
 * Inyectar en el <head> la hoja de estilos de las notificaciones.
 * Evitar duplicados si la página ya incluye el <link> manualmente.
 *
 * @returns {void}
 */
function cargarEstilosNotificaciones() {
  if (document.querySelector('link[href$="notificaciones.css"]')) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = RUTA_CSS_NOTIFICACIONES;
  link.dataset.origen = 'layout';
  document.head.appendChild(link);
}

// Ejecutar al importar el módulo para que el estilo cargue antes de dibujar la campana
cargarEstilosNotificaciones();

/**
 * Listar las opciones del menú.
 * Cada opción contiene: href (destino), etiqueta (texto) e icono (trazos SVG).
 */
const ENLACES = [
  { href: '/pages/dashboard.html', etiqueta: 'Dashboard', icono: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
  { href: '/pages/backlog.html', etiqueta: 'Backlog', icono: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>' },
  { href: '/pages/sprints.html', etiqueta: 'Sprints', icono: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>' },
  { href: '/pages/tablero.html', etiqueta: 'Tablero', icono: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>' },
  { href: '/pages/mis-horas.html', etiqueta: 'Mis horas', icono: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { href: '/pages/daily.html', etiqueta: 'Daily', icono: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>' },
  { href: '/pages/impedimentos.html', etiqueta: 'Impedimentos', icono: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>' },
  { href: '/pages/capacidad.html', etiqueta: 'Capacidad', icono: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { href: '/pages/sprint-detalle.html', etiqueta: 'Ciclo', icono: '<path d="M5 3v18M5 4h11l-2 4 2 4H5"/>' },
  { href: '/pages/calendario.html', etiqueta: 'Calendario', icono: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 14h2M14 14h2"/>' },
  { href: '/pages/equipos.html', etiqueta: 'Equipo', icono: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5a3 3 0 0 1 0 6M21 20c0-2.6-1.6-4.8-4-5.6"/>' },
  { href: '/pages/metricas.html', etiqueta: 'Métricas', icono: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>' },
  { href: '/pages/auditoria.html', etiqueta: 'Bitácora', permiso: 'auditoria.ver', icono: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>' },
];

/** Clase que marca un grupo del menú como desplegado. */
const CLASE_GRUPO_ABIERTO = 'barra-superior__grupo--abierto';

/**
 * Agrupar las opciones del menú por etapa de trabajo, en el orden en que se muestran.
 * Cada grupo contiene: etiqueta (texto del botón) y hrefs (opciones de ENLACES que despliega).
 * Un grupo con una sola opción se dibuja como enlace directo, sin desplegable.
 */
const GRUPOS = [
  {
    etiqueta: 'Planificación',
    hrefs: ['/pages/backlog.html', '/pages/sprints.html', '/pages/capacidad.html'],
  },
  {
    etiqueta: 'Ejecución',
    hrefs: ['/pages/tablero.html', '/pages/daily.html', '/pages/impedimentos.html', '/pages/sprint-detalle.html'],
  },
  {
    etiqueta: 'Seguimiento',
    hrefs: ['/pages/dashboard.html', '/pages/metricas.html', '/pages/calendario.html', '/pages/mis-horas.html', '/pages/auditoria.html'],
  },
  {
    etiqueta: 'Equipo',
    hrefs: ['/pages/equipos.html'],
  },
];

/** Controlador que libera los eventos de los menús cuando la barra se redibuja. */
let controladorMenus = null;

/**
 * Generar el atributo data-permiso de una opción del menú que requiere un permiso del proyecto.
 * permisos-ui.js mantiene oculta la opción hasta confirmar que el rol de la persona la autoriza.
 *
 * @param {{permiso?: string}} enlace Opción del menú; puede incluir la clave del permiso requerido.
 * @returns {string} Atributo listo para insertar en la etiqueta, o cadena vacía si la opción no requiere permiso.
 * @author Citlaly Morales Viveros
 */
function atributoPermiso(enlace) {
  return enlace.permiso ? ` data-permiso="${enlace.permiso}"` : '';
}

/**
 * Generar el HTML de un enlace de navegación.
 * Marcar con aria-current="page" el enlace de la página abierta.
 *
 * @param {{href: string, etiqueta: string, icono: string}} enlace Opción del menú.
 * @returns {string}
 */
function crearEnlaceHtml(enlace) {
  const activo = enlace.href === location.pathname ? ' aria-current="page"' : '';
  return `<a class="barra-superior__enlace" href="${enlace.href}"${activo}${atributoPermiso(enlace)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${enlace.icono}</svg>
      ${enlace.etiqueta}</a>`;
}

/**
 * Generar el HTML de un grupo del menú.
 * Devolver un enlace directo si el grupo tiene una sola opción; de lo contrario,
 * un botón que despliega sus opciones. El botón se marca como activo cuando la
 * página abierta pertenece al grupo.
 *
 * @param {{etiqueta: string, hrefs: string[]}} grupo Grupo definido en GRUPOS.
 * @param {number} indice Posición del grupo, usada para generar un id único.
 * @returns {string}
 */
function crearGrupoHtml(grupo, indice) {
  const enlaces = grupo.hrefs
    .map(href => ENLACES.find(e => e.href === href))
    .filter(Boolean);

  if (enlaces.length === 1) return crearEnlaceHtml(enlaces[0]);

  const idMenu = `menu-grupo-${indice}`;
  const activo = enlaces.some(e => e.href === location.pathname) ? ' barra-superior__boton--activo' : '';

  return `<div class="barra-superior__grupo">
    <button class="barra-superior__enlace barra-superior__boton${activo}" type="button" aria-expanded="false" aria-controls="${idMenu}">
      ${grupo.etiqueta}
      <svg class="barra-superior__flecha" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="barra-superior__menu" id="${idMenu}">${enlaces.map(e => crearEnlaceHtml(e)).join('')}</div>
  </div>`;
}

/**
 * Abrir o cerrar un grupo del menú y sincronizar aria-expanded del botón.
 * Al cerrarlo, también se descarta el estado fijado por clic.
 *
 * @param {HTMLElement} grupo Contenedor del grupo.
 * @param {boolean} abierto Indicar si el grupo debe quedar desplegado.
 * @returns {void}
 */
function establecerAbierto(grupo, abierto) {
  grupo.classList.toggle(CLASE_GRUPO_ABIERTO, abierto);
  grupo.querySelector('.barra-superior__boton').setAttribute('aria-expanded', String(abierto));
  if (!abierto) delete grupo.dataset.fijo;
}

/**
 * Activar el comportamiento de los grupos desplegables de la barra.
 * - Con ratón, el grupo se abre al pasar el cursor y se cierra al salir.
 * - Con clic o toque, el grupo queda fijo hasta un nuevo clic, Esc o clic fuera.
 * - Con teclado, la flecha abajo abre el grupo y las flechas recorren sus opciones.
 * Es seguro llamarlo varias veces: libera los eventos de la llamada anterior.
 *
 * @param {HTMLElement} contenedor Elemento #barra-superior ya renderizado.
 * @returns {void}
 */
function activarMenus(contenedor) {
  controladorMenus?.abort();
  controladorMenus = new AbortController();
  const { signal } = controladorMenus;

  const grupos = [...contenedor.querySelectorAll('.barra-superior__grupo')];
  const hayCursor = () => globalThis.matchMedia('(hover: hover)').matches;
  const cerrarTodos = () => grupos.forEach(g => establecerAbierto(g, false));

  grupos.forEach(grupo => {
    const boton = grupo.querySelector('.barra-superior__boton');
    const opciones = [...grupo.querySelectorAll('.barra-superior__menu a')];

    boton.addEventListener('click', () => {
      const fijo = grupo.classList.contains(CLASE_GRUPO_ABIERTO) && grupo.dataset.fijo;
      if (fijo) {
        establecerAbierto(grupo, false);
        return;
      }
      grupos.forEach(otro => establecerAbierto(otro, otro === grupo));
      grupo.dataset.fijo = 'true';
    }, { signal });

    grupo.addEventListener('mouseenter', () => {
      if (!hayCursor()) return;
      grupos.forEach(otro => { if (otro !== grupo) establecerAbierto(otro, false); });
      establecerAbierto(grupo, true);
    }, { signal });

    grupo.addEventListener('mouseleave', () => {
      if (hayCursor() && !grupo.dataset.fijo) establecerAbierto(grupo, false);
    }, { signal });

    grupo.addEventListener('focusout', evento => {
      if (!grupo.contains(evento.relatedTarget)) establecerAbierto(grupo, false);
    }, { signal });

    grupo.addEventListener('keydown', evento => {
      const posicion = opciones.indexOf(document.activeElement);

      if (evento.key === 'Escape' && grupo.classList.contains(CLASE_GRUPO_ABIERTO)) {
        establecerAbierto(grupo, false);
        boton.focus();
      } else if (evento.key === 'ArrowDown') {
        evento.preventDefault();
        grupos.forEach(otro => establecerAbierto(otro, otro === grupo));
        grupo.dataset.fijo = 'true';
        opciones[Math.min(posicion + 1, opciones.length - 1)].focus();
      } else if (evento.key === 'ArrowUp' && posicion >= 0) {
        evento.preventDefault();
        (posicion === 0 ? boton : opciones[posicion - 1]).focus();
      }
    }, { signal });
  });

  document.addEventListener('click', evento => {
    if (!evento.target.closest('.barra-superior__grupo')) cerrarTodos();
  }, { signal });
}

/**
 * Leer el usuario autenticado desde localStorage (clave "usuario", en JSON).
 * Devolver un usuario genérico si no existe o si el JSON es inválido.
 * Reemplazar por auth.js cuando el login esté implementado.
 *
 * @returns {{nombre: string, rol: string}}
 */
function leerUsuario() {
  try {
    const guardado = JSON.parse(localStorage.getItem('usuario'));
    if (guardado && guardado.nombre) return { nombre: guardado.nombre, rol: guardado.rol || '' };
  } catch { /* Ignorar JSON inválido y usar el valor por defecto */ }
  return { nombre: 'Usuario', rol: '' };
}

/** Campana de notificaciones montada actualmente (para liberarla si la barra se redibuja). */
let campana = null;

/**
 * Montar la campana de notificaciones (HU-24) dentro de #notificaciones-root.
 * Se importa de forma dinámica: si el componente fallara, el menú sigue funcionando.
 * Es seguro llamarlo varias veces: el componente no duplica la campana.
 *
 * @returns {Promise<void>}
 */
async function montarCampana() {
  try {
    const { inicializarNotificaciones } = await import(RUTA_MODULO_NOTIFICACIONES);
    const raiz = document.getElementById('notificaciones-root');
    if (!raiz) return;
    campana = inicializarNotificaciones({
      contenedor: raiz,
      socket: globalThis.scrumflowSocket ?? globalThis.socket ?? null,
    });
  } catch (error) {
    console.warn('[layout] No se pudo montar la campana de notificaciones:', error);
  }
}

/**
 * Renderizar la barra superior dentro del contenedor #barra-superior.
 * Marcar con aria-current="page" el enlace de la página abierta.
 * Escapar los datos del usuario antes de insertarlos como HTML.
 *
 * @returns {void}
 */
export function montarBarraSuperior() {
  // Localizar el contenedor; terminar si la página no lo incluye
  const contenedor = document.getElementById('barra-superior');
  if (!contenedor) return;

  // Si la barra ya tenía campana, liberarla antes de volver a dibujar
  campana?.destruir();
  campana = null;

  const usuario = leerUsuario();

  // Generar el HTML de cada enlace y marcar el activo comparando la ruta actual
  const enlaces = GRUPOS.map(crearGrupoHtml).join('');

  // Componer la barra e inyectar el contenedor de notificaciones (HU-24)
  contenedor.innerHTML = `
    <a class="barra-superior__marca" href="/pages/dashboard.html" aria-label="AgileDesk, ir al dashboard">
      <span class="barra-superior__logo" aria-hidden="true">A</span>
      <span class="barra-superior__marca-texto">
        <span class="barra-superior__nombre">AgileDesk</span><br />
        <span class="barra-superior__sub">Gestión de proyectos</span>
      </span>
    </a>
    <nav class="barra-superior__enlaces" aria-label="Principal">${enlaces}</nav>
    <div class="barra-superior__usuario" style="display: flex; align-items: center; gap: 15px;">

      <!-- HU-24: contenedor donde se monta la campana -->
      <div id="notificaciones-root"></div>

      <a href="/pages/perfil.html" style="display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit;">
        <div class="barra-superior__usuario-texto">
          <div class="barra-superior__usuario-nombre">${escaparHtml(usuario.nombre)}</div>
          <div class="barra-superior__usuario-rol">${escaparHtml(usuario.rol)}</div>
        </div>
        <div class="barra-superior__avatar" aria-hidden="true">${escaparHtml(iniciales(usuario.nombre))}</div>
      </a>
    </div>`;

  activarMenus(contenedor);

  // Montar la campana en todas las páginas que usen la barra
  montarCampana();
}