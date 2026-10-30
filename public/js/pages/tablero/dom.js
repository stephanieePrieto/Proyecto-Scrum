// Responsable: Alfonso - HU-20: utilidades compartidas del detalle de tarjeta
/**
 * @file dom.js
 * @description Creación de nodos DOM sin innerHTML (evita XSS), avisos con reintento, formato de fechas
 *              y tamaños, iniciales de nombres y mensajes de error del servidor.
 *              No importa ningún otro módulo: un fallo en otro archivo no impide cargar este.
 */

/** @constant {number} Peso máximo por adjunto (10 MB). */
export const LIMITE_ADJUNTO_BYTES = 10 * 1024 * 1024;

/** @constant {number} Longitud máxima de un comentario. */
export const MAX_COMENTARIO = 2000;

/** @constant {Set<string>} Extensiones no permitidas (ejecutables y scripts). */
export const EXTENSIONES_BLOQUEADAS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.sh', '.ps1', '.vbs', '.jar', '.app', '.dll', '.apk',
]);

/**
 * Crea un nodo DOM.
 * @param {string} etiqueta Nombre de la etiqueta.
 * @param {Object} [opciones]
 * @param {string} [opciones.clase] Clases CSS.
 * @param {string} [opciones.texto] Texto (se asigna con textContent).
 * @param {Object} [opciones.atributos] Atributos; `true` crea atributo vacío, `false`/`null` lo omiten.
 * @param {Object} [opciones.eventos] Mapa evento → función.
 * @param {Array<Node|string|null|false>|Node|string} [hijos] Hijos del nodo.
 * @returns {HTMLElement}
 */
export function crear(etiqueta, opciones = {}, hijos = []) {
  const { clase, texto, atributos = {}, eventos = {} } = opciones;
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor !== null && valor !== undefined && valor !== false) {
      nodo.setAttribute(nombre, valor === true ? '' : String(valor));
    }
  }
  for (const [evento, funcion] of Object.entries(eventos)) nodo.addEventListener(evento, funcion);
  for (const hijo of [].concat(hijos)) {
    if (hijo !== null && hijo !== undefined && hijo !== false) nodo.append(hijo);
  }
  return nodo;
}

/**
 * Obtiene las iniciales (máximo 2) de un nombre completo.
 * @param {string} nombre Nombre completo, por ejemplo "Elena Rostova".
 * @returns {string} Iniciales en mayúsculas, por ejemplo "ER".
 */
export function iniciales(nombre = '') {
  return String(nombre).split(' ').filter(Boolean).map((parte) => parte[0]).slice(0, 2).join('').toUpperCase();
}

/**
 * Devuelve un mensaje claro en español a partir de un error de `api()`.
 * @param {Error & {estado?: number, cuerpo?: Object|null}} error Error capturado.
 * @param {string} [porDefecto] Mensaje cuando el servidor no envía uno.
 * @returns {string}
 */
export function mensajeError(error, porDefecto = 'Ocurrió un error inesperado. Inténtalo de nuevo.') {
  if (!error) return porDefecto;
  if (error.estado === undefined) {
    return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  }
  const mensaje = error.cuerpo?.error ?? error.cuerpo?.mensaje ?? error.cuerpo?.message;
  return typeof mensaje === 'string' && mensaje.trim() ? mensaje : porDefecto;
}

/**
 * Crea una franja de aviso de error con botones de acción (por ejemplo "Reintentar").
 * @param {string} [clase] Clases CSS del contenedor.
 * @returns {{nodo: HTMLElement, mostrar: function(string, {texto:string, alClick:function}[]=): void, ocultar: function(): void}}
 */
export function crearAviso(clase = 'dt-aviso') {
  const mensaje = crear('span', { clase: 'dt-aviso__texto' });
  const acciones = crear('div', { clase: 'dt-aviso__acciones' });
  const nodo = crear('div', { clase, atributos: { role: 'alert', hidden: true } }, [mensaje, acciones]);

  return {
    nodo,
    mostrar(texto, botones = []) {
      mensaje.textContent = texto;
      acciones.replaceChildren(...botones.map(({ texto: etiqueta, alClick }) => crear('button', {
        clase: 'dt-boton dt-boton--secundario dt-boton--pequeno',
        texto: etiqueta,
        atributos: { type: 'button' },
        eventos: { click: alClick },
      })));
      nodo.hidden = false;
    },
    ocultar() {
      nodo.hidden = true;
      acciones.replaceChildren();
    },
  };
}

/**
 * Formatea una fecha ISO en la zona horaria del navegador.
 * @param {string} valor Fecha ISO.
 * @returns {string}
 */
export function formatearFecha(valor) {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Formatea un peso en bytes como B, KB o MB.
 * @param {number} bytes Peso en bytes.
 * @returns {string}
 */
export function formatearTamano(bytes) {
  const numero = (n) => n.toLocaleString('es-MX', { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${numero(bytes / 1024)} KB`;
  return `${numero(bytes / (1024 * 1024))} MB`;
}