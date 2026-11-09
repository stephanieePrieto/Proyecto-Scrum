// Responsable: Alfonso - HU-21: carriles (swimlanes) del tablero y reasignación al arrastrar a otro carril
/**
 * @file swimlanes.js
 * @description Dibuja el tablero en carriles horizontales (por historia o por persona) y se encarga de lo que
 *              pasa al soltar una tarjeta en otro carril (HU-21, criterios 2 y 4).
 *
 * Convive con el arrastre del tablero (arrastrar.js, HU-18) sin modificarlo:
 *   - Cada celda de un carril lleva `data-columna-id` y su lista un id que empieza con `lista-tarjetas-`,
 *     así el arrastre entre columnas dentro del mismo carril sigue funcionando igual.
 *   - Los contadores del encabezado no usan el id `wip-col-<id>`; por eso el recálculo de arrastrar.js no los
 *     toca y aquí se suman las tarjetas de la columna en todos los carriles.
 *   - Al soltar en otro carril, un escuchador en fase de captura se adelanta a arrastrar.js: si la decisión es
 *     reasignar, pide confirmación; si no se permite, avisa. En ambos casos detiene el evento.
 */

import { crearElementoTarjeta } from './tarjeta.js';
import { MODOS_AGRUPACION, decidirMovimientoEntreCarriles } from './filtros.reglas.js';

/** Clase del bloque que reemplaza a las columnas mientras el tablero está agrupado en carriles. */
const CLASE_CARRILES = 'carriles';

/** Clase que arrastrar.js pone a una lista mientras se arrastra encima de ella. */
const CLASE_RESALTADO = 'bg-indigo-50/50';

/**
 * Indica si el tablero está dibujado en carriles.
 * @param {HTMLElement|null} contenedor - #tablero-contenedor.
 * @returns {boolean}
 */
export function estaEnModoCarriles(contenedor) {
  return Boolean(contenedor?.querySelector(`:scope > .${CLASE_CARRILES}`));
}

/**
 * Convierte la clave de un carril en un fragmento válido para un id del DOM.
 * @param {string} clave
 * @returns {string}
 */
function fragmentoId(clave) {
  return String(clave).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Crea un elemento con clase y texto opcionales.
 * @param {string} etiqueta
 * @param {string} [clase]
 * @param {string} [texto]
 * @returns {HTMLElement}
 */
function crear(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

/**
 * Texto "N tarea(s)" para el encabezado de un carril.
 * @param {number} cantidad
 * @returns {string}
 */
function textoConteo(cantidad) {
  return `${cantidad} ${cantidad === 1 ? 'tarea' : 'tareas'}`;
}

/**
 * Dibuja el tablero en carriles dentro del contenedor, reemplazando las columnas.
 *
 * @param {HTMLElement} contenedor - #tablero-contenedor.
 * @param {{clave: string, titulo: string, tareas: Object[]}[]} carriles - Resultado de agruparEnCarriles.
 * @param {{id: number, nombre: string, limite_wip: number|null}[]} columnas - Columnas del tablero en orden.
 * @param {string} modo - MODOS_AGRUPACION.HISTORIA o MODOS_AGRUPACION.PERSONA.
 * @returns {void}
 */
export function renderizarCarriles(contenedor, carriles, columnas, modo) {
  if (!contenedor) return;
  contenedor.replaceChildren();

  const raiz = crear('div', CLASE_CARRILES);
  raiz.dataset.modo = modo;
  raiz.style.setProperty('--carriles-columnas', String(Math.max(columnas.length, 1)));

  // Encabezado con el nombre de cada columna y el total de tarjetas visibles en ella
  const encabezado = crear('div', 'carriles__encabezado');
  for (const columna of columnas) {
    const celda = crear('div', 'carriles__columna');
    const contador = crear('span', 'carriles__contador', '0');
    contador.id = `carriles-wip-${columna.id}`;
    contador.dataset.columnaId = columna.id;
    contador.dataset.limiteWip = columna.limite_wip ?? '';
    contador.title = columna.limite_wip ? `Límite WIP: ${columna.limite_wip}` : 'Sin límite WIP';
    celda.append(crear('span', 'carriles__columna-nombre', columna.nombre), contador);
    encabezado.append(celda);
  }
  raiz.append(encabezado);

  const textoCarril = modo === MODOS_AGRUPACION.PERSONA ? 'Persona' : 'Historia';
  for (const carril of carriles) {
    const seccion = crear('section', 'carril');
    seccion.dataset.carril = carril.clave;
    seccion.dataset.titulo = carril.titulo;
    seccion.setAttribute('aria-label', `${textoCarril}: ${carril.titulo}`);

    const cabecera = crear('div', 'carril__encabezado');
    cabecera.append(crear('span', 'carril__titulo', carril.titulo), crear('span', 'carril__conteo', textoConteo(carril.tareas.length)));

    const celdas = crear('div', 'carril__celdas');
    for (const columna of columnas) {
      const celda = crear('div', 'carril__celda');
      celda.dataset.columnaId = columna.id;
      celda.dataset.carril = carril.clave;
      // arrastrar.js (HU-23) lee esto de la columna destino para decidir si una tarjeta bloqueada puede entrar
      celda.dataset.esFinal = columna.es_final ? 'true' : 'false';

      const lista = crear('div', 'carril__lista');
      lista.id = `lista-tarjetas-${columna.id}-carril-${fragmentoId(carril.clave)}`;
      for (const tarea of carril.tareas) {
        if (String(tarea.columna_id) === String(columna.id)) lista.append(crearElementoTarjeta(tarea));
      }
      celda.append(lista);
      celdas.append(celda);
    }

    seccion.append(cabecera, celdas);
    raiz.append(seccion);
  }

  contenedor.append(raiz);
  actualizarContadoresCarriles(contenedor);
}

/**
 * Recalcula el total por columna (sumando todos los carriles) y el número de tareas de cada carril.
 * Marca la columna si supera su límite WIP, como hace arrastrar.js en la vista de columnas.
 *
 * @param {HTMLElement} contenedor - #tablero-contenedor.
 * @returns {void}
 */
export function actualizarContadoresCarriles(contenedor) {
  const raiz = contenedor?.querySelector(`:scope > .${CLASE_CARRILES}`);
  if (!raiz) return;

  raiz.querySelectorAll('.carriles__contador').forEach((contador) => {
    const id = CSS.escape(contador.dataset.columnaId);
    const cantidad = raiz.querySelectorAll(`.carril__celda[data-columna-id="${id}"] .tarjeta-item`).length;
    const limite = Number(contador.dataset.limiteWip);
    contador.textContent = String(cantidad);
    contador.classList.toggle('carriles__contador--excedido', contador.dataset.limiteWip !== '' && limite > 0 && cantidad > limite);
  });

  raiz.querySelectorAll('.carril').forEach((carril) => {
    const cantidad = carril.querySelectorAll('.tarjeta-item').length;
    const conteo = carril.querySelector('.carril__conteo');
    if (conteo) conteo.textContent = textoConteo(cantidad);
    carril.classList.toggle('carril--vacio', cantidad === 0);
  });
}

/**
 * Muestra el modal de confirmación y resuelve true si la persona confirma.
 * Si la página no tiene el modal, usa la confirmación nativa del navegador.
 *
 * @param {string} texto - Pregunta que se muestra.
 * @returns {Promise<boolean>}
 */
export function pedirConfirmacion(texto) {
  const overlay = document.getElementById('overlay-confirmar-reasignacion');
  const parrafo = document.getElementById('texto-confirmar-reasignacion');
  const botonConfirmar = document.getElementById('btn-confirmar-reasignacion');
  const botonCancelar = document.getElementById('btn-cancelar-reasignacion');
  if (!overlay || !parrafo || !botonConfirmar || !botonCancelar) return Promise.resolve(window.confirm(texto));

  return new Promise((resolver) => {
    const focoAnterior = document.activeElement;
    parrafo.textContent = texto;
    overlay.inert = false;
    overlay.classList.remove('modal--hidden');
    botonConfirmar.focus();

    const alTeclear = (evento) => {
      if (evento.key === 'Escape') cerrar(false);
    };
    const alClicFondo = (evento) => {
      if (evento.target === overlay) cerrar(false);
    };
    const alConfirmar = () => cerrar(true);
    const alCancelar = () => cerrar(false);

    function cerrar(resultado) {
      overlay.classList.add('modal--hidden');
      overlay.inert = true;
      document.removeEventListener('keydown', alTeclear);
      overlay.removeEventListener('click', alClicFondo);
      botonConfirmar.removeEventListener('click', alConfirmar);
      botonCancelar.removeEventListener('click', alCancelar);
      if (focoAnterior && typeof focoAnterior.focus === 'function') focoAnterior.focus();
      resolver(resultado);
    }

    document.addEventListener('keydown', alTeclear);
    overlay.addEventListener('click', alClicFondo);
    botonConfirmar.addEventListener('click', alConfirmar);
    botonCancelar.addEventListener('click', alCancelar);
  });
}

/**
 * Registra (una sola vez) el manejo de soltar tarjetas en otro carril.
 *
 * @param {Object} opciones
 * @param {HTMLElement} opciones.contenedor - #tablero-contenedor.
 * @param {() => string} opciones.obtenerModo - Agrupación vigente.
 * @param {(tareaId: string) => Object|undefined} opciones.buscarTarea - Tarea por id, como la conoce el tablero.
 * @param {(tarea: Object, responsableId: number, nombreDestino: string) => Promise<void>} opciones.alConfirmarReasignacion
 * @param {(texto: string, tono?: string) => void} opciones.avisar - Muestra un aviso discreto.
 * @param {() => void} [opciones.alTerminarArrastre] - Se llama al terminar cualquier arrastre.
 * @returns {void}
 */
export function inicializarArrastreEntreCarriles({ contenedor, obtenerModo, buscarTarea, alConfirmarReasignacion, avisar, alTerminarArrastre }) {
  if (!contenedor || contenedor.dataset.carrilesArrastre === 'listo') return;
  contenedor.dataset.carrilesArrastre = 'listo';

  /** Tarjeta que se está arrastrando y carril del que salió. */
  let origen = null;

  contenedor.addEventListener('dragstart', (evento) => {
    const tarjeta = evento.target.closest?.('.tarjeta-item');
    const carril = tarjeta?.closest('[data-carril]');
    origen = tarjeta && carril ? { tareaId: tarjeta.dataset.tareaId, carril: carril.dataset.carril } : null;
  }, true);

  contenedor.addEventListener('dragend', () => {
    origen = null;
    if (alTerminarArrastre) requestAnimationFrame(alTerminarArrastre);
  });

  contenedor.addEventListener('drop', (evento) => {
    const modo = obtenerModo();
    const destino = evento.target.closest?.('[data-carril]');
    if (!origen || !destino || modo === MODOS_AGRUPACION.NINGUNO) return;

    const decision = decidirMovimientoEntreCarriles(modo, origen.carril, destino.dataset.carril);
    if (decision.tipo === 'normal') return;

    // Movimiento entre carriles: no debe llegar a arrastrar.js, que lo trataría como cambio de columna
    evento.preventDefault();
    evento.stopImmediatePropagation();
    contenedor.querySelectorAll('[id^="lista-tarjetas-"]').forEach((lista) => lista.classList.remove(CLASE_RESALTADO));

    if (decision.tipo === 'rechazar') {
      avisar(decision.mensaje, 'error');
      return;
    }

    const tarea = buscarTarea(origen.tareaId);
    if (!tarea) return;
    const nombreDestino = destino.closest('.carril')?.dataset.titulo || 'otra persona';
    const nombreActual = tarea.responsable || 'Sin asignar';
    pedirConfirmacion(`¿Reasignar «${tarea.titulo}» de ${nombreActual} a ${nombreDestino}? La tarea se queda en su columna actual.`)
      .then((confirmado) => {
        if (confirmado) return alConfirmarReasignacion(tarea, decision.responsableId, nombreDestino);
        return undefined;
      })
      .catch((error) => console.error('[HU-21] Error al reasignar la tarea:', error));
  }, true);
}
