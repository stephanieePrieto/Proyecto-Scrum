/**
 * @file github.js
 * @description Presenta la actividad y las contribuciones de un repositorio público del proyecto.
 */
import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { cargarPermisos } from '../core/permisos-ui.js';

const $ = (id) => document.getElementById(id);
const proyectoId = Number(localStorage.getItem('proyectoActivo'));
let solicitudEnCurso = false;

/** Presenta una fecha de commit en el idioma de la aplicación. */
function formatearFecha(fecha) {
  if (!fecha) return 'Fecha no disponible';
  const valor = new Date(fecha);
  return Number.isNaN(valor.getTime())
    ? 'Fecha no disponible'
    : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(valor);
}

/** Crea un enlace externo solo cuando el destino es github.com. */
function crearEnlaceGitHub(url, texto) {
  const enlace = document.createElement('a');
  enlace.textContent = texto;
  try {
    const destino = new URL(url);
    if (destino.protocol === 'https:' && destino.hostname === 'github.com') {
      enlace.href = destino.href;
      enlace.target = '_blank';
      enlace.rel = 'noopener noreferrer';
    } else {
      enlace.removeAttribute('href');
    }
  } catch {
    enlace.removeAttribute('href');
  }
  return enlace;
}

/** Dibuja la lista de personas y su cantidad de contribuciones. */
function pintarContribuciones(contribuciones) {
  const lista = $('github-contribuciones');
  lista.replaceChildren();
  $('github-sin-contribuciones').hidden = contribuciones.length > 0;

  contribuciones.forEach((persona) => {
    const item = document.createElement('li');
    item.className = 'github-contribucion';
    const identidad = persona.url
      ? crearEnlaceGitHub(persona.url, persona.usuario)
      : document.createElement('span');
    if (!persona.url) identidad.textContent = persona.usuario;
    const cantidad = document.createElement('span');
    cantidad.textContent = `${persona.commits} commits`;
    item.append(identidad, cantidad);
    lista.appendChild(item);
  });
}

/** Dibuja los commits más recientes recibidos desde el servidor. */
function pintarCommits(commits) {
  const lista = $('github-commits');
  lista.replaceChildren();
  $('github-sin-commits').hidden = commits.length > 0;

  commits.forEach((commit) => {
    const item = document.createElement('li');
    const mensaje = document.createElement('p');
    mensaje.textContent = commit.mensaje || 'Commit sin descripción';
    const meta = document.createElement('div');
    meta.className = 'github-commit__meta';
    const autor = document.createElement('span');
    autor.textContent = commit.autor;
    const fecha = document.createElement('time');
    fecha.dateTime = commit.fecha || '';
    fecha.textContent = formatearFecha(commit.fecha);
    meta.append(autor, fecha);
    item.append(mensaje, meta);
    item.appendChild(crearEnlaceGitHub(commit.url, String(commit.sha || '').slice(0, 7)));
    lista.appendChild(item);
  });
}

/** Carga o vuelve a consultar commits y contribuciones del proyecto activo. */
async function cargarActividad() {
  if (solicitudEnCurso) return;
  solicitudEnCurso = true;
  $('btn-actualizar-github').disabled = true;
  $('github-estado').hidden = false;
  $('github-estado').textContent = 'Cargando actividad del repositorio…';
  $('github-contenido').hidden = true;
  $('github-configurar').hidden = true;

  try {
    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
      $('github-estado').textContent = 'Selecciona un proyecto desde el Dashboard para consultar su repositorio.';
      return;
    }

    const datos = await api(`/github/proyectos/${encodeURIComponent(proyectoId)}`);
    if (!datos.conectado) {
      $('github-estado').textContent = datos.mensaje;
      $('github-configurar').hidden = false;
      $('github-enlace-configuracion').href = `./configuracion-proyecto.html?id=${encodeURIComponent(proyectoId)}`;
      cargarPermisos(proyectoId).catch((error) => {
        console.warn('[github] No se pudieron comprobar los permisos de configuración:', error);
      });
      return;
    }

    $('github-estado').hidden = true;
    $('github-contenido').hidden = false;
    $('github-repositorio').href = datos.repositorio;
    $('github-repositorio').textContent = datos.repositorio;
    $('github-actualizado').textContent = `Consultado ${formatearFecha(new Date().toISOString())}`;
    pintarContribuciones(datos.contribuciones || []);
    pintarCommits(datos.commits || []);
  } catch (error) {
    $('github-estado').textContent = error.cuerpo?.error ||
      error.cuerpo?.mensaje ||
      'No se pudo cargar GitHub. Revisa tu conexión e inténtalo de nuevo.';
  } finally {
    solicitudEnCurso = false;
    $('btn-actualizar-github').disabled = false;
  }
}

montarBarraSuperior();
$('btn-actualizar-github').addEventListener('click', cargarActividad);
window.addEventListener('focus', cargarActividad);
window.setInterval(() => {
  if (document.visibilityState === 'visible') cargarActividad();
}, 5 * 60 * 1000);
cargarActividad();
