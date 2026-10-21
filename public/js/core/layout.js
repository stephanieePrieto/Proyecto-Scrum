/**
 * Construir e insertar la barra superior de navegación en <header id="barra-superior">.
 * Reutilizar este módulo en todas las páginas para mantener un menú único.
 */
import { escaparHtml, iniciales } from './utils.js';

/**
 * Listar las opciones del menú.
 * Cada opción contiene: href (destino), etiqueta (texto) e icono (trazos SVG).
 */
const ENLACES = [
  { href: '/pages/dashboard.html', etiqueta: 'Dashboard', icono: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
  { href: '/pages/backlog.html',   etiqueta: 'Backlog',   icono: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>' },
  { href: '/pages/sprints.html',   etiqueta: 'Sprints',   icono: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>' },
  { href: '/pages/tablero.html',   etiqueta: 'Tablero',   icono: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>' },
  { href: '/pages/equipos.html',   etiqueta: 'Equipo',    icono: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5a3 3 0 0 1 0 6M21 20c0-2.6-1.6-4.8-4-5.6"/>' },
  { href: '/pages/metricas.html',  etiqueta: 'Métricas',  icono: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>' },
];

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

  const usuario = leerUsuario();

  // Generar el HTML de cada enlace y marcar el activo comparando la ruta actual
  const enlaces = ENLACES.map(e => {
    const activo = e.href === location.pathname ? ' aria-current="page"' : '';
    return `<a class="barra-superior__enlace" href="${e.href}"${activo}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e.icono}</svg>
      ${e.etiqueta}</a>`;
  }).join('');

  // Componer la barra e inyectar el contenedor de notificaciones
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
      
      <!-- Contenedor inyectado para la inicialización de la campana -->
      <div id="notificaciones-root"></div>
      
      <div class="barra-superior__usuario-texto">
        <div class="barra-superior__usuario-nombre">${escaparHtml(usuario.nombre)}</div>
        <div class="barra-superior__usuario-rol">${escaparHtml(usuario.rol)}</div>
      </div>
      <div class="barra-superior__avatar" aria-hidden="true">${escaparHtml(iniciales(usuario.nombre))}</div>
    </div>`;
}