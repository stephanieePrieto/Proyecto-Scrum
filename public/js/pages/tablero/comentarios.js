// Responsable: Alfonso - HU-20: comentarios y menciones (@usuario) del detalle de tarjeta
/**
 * @file comentarios.js
 * @description Lista y publica comentarios. Impide envíos vacíos, sugiere menciones al escribir "@",
 *              y si la publicación falla conserva el texto y ofrece "Reintentar".
 *              Solo importa api.js y dom.js: no depende de utils.js.
 */
import { api } from '../../core/api.js';
import { crear, crearAviso, mensajeError, formatearFecha, iniciales, MAX_COMENTARIO } from './dom.js';

/** Misma regla que el servidor: `@usuario` precedido de inicio de texto o de un carácter que no sea letra, punto o arroba. */
const PATRON_MENCION = /(^|[^\w@.])@([\w.+-]+)/g;

/** Borradores por tarjeta: sobreviven mientras se cierra y abre el detalle. */
const borradores = new Map();

/**
 * Convierte un texto en nodos, resaltando las menciones de personas conocidas.
 * @param {string} texto Comentario.
 * @param {Set<string>} conocidos Nombres de usuario mencionables.
 * @returns {DocumentFragment}
 */
function textoConMenciones(texto, conocidos) {
  const fragmento = document.createDocumentFragment();
  let ultimo = 0;
  for (const coincidencia of texto.matchAll(PATRON_MENCION)) {
    const token = coincidencia[2].replace(/\.+$/, '');
    if (!conocidos.has(token.toLowerCase())) continue;
    const inicio = coincidencia.index + coincidencia[1].length;
    fragmento.append(texto.slice(ultimo, inicio), crear('span', { clase: 'dt-mencion', texto: `@${token}` }));
    ultimo = inicio + 1 + token.length;
  }
  fragmento.append(texto.slice(ultimo));
  return fragmento;
}

/**
 * Monta la sección de comentarios dentro de un contenedor.
 * @param {HTMLElement} contenedor Sección donde se dibuja.
 * @param {number} tareaId Tarjeta.
 * @param {{alCambiar?: function(): void}} [opciones] `alCambiar` se llama tras publicar (refresca el historial).
 */
export function montarComentarios(contenedor, tareaId, { alCambiar = () => {} } = {}) {
  const idCampo = `dt-comentario-${tareaId}`;
  let comentarios = [];
  let mencionables = [];
  let enviando = false;
  let sugerencias = [];
  let indice = 0;

  const contador = crear('span', { clase: 'dt-contador' });
  const lista = crear('ul', { clase: 'dt-comentarios__lista', atributos: { 'aria-live': 'polite' } });
  const avisoCarga = crearAviso();
  const avisoEnvio = crearAviso();

  const campo = crear('textarea', {
    clase: 'dt-entrada dt-entrada--area',
    atributos: {
      id: idCampo,
      rows: 3,
      maxlength: MAX_COMENTARIO,
      placeholder: 'Escribe un comentario… usa @usuario para mencionar',
      'aria-autocomplete': 'list',
      'aria-controls': `${idCampo}-sugerencias`,
      'aria-expanded': 'false',
    },
  });
  const sugerenciasEl = crear('ul', {
    clase: 'dt-sugerencias',
    atributos: { id: `${idCampo}-sugerencias`, role: 'listbox', hidden: true, 'aria-label': 'Personas a mencionar' },
  });
  const caracteres = crear('span', { clase: 'dt-contador' });
  const botonPublicar = crear('button', {
    clase: 'dt-boton dt-boton--primario',
    texto: 'Publicar',
    atributos: { type: 'button' },
    eventos: { click: () => publicar() },
  });

  /** Dibuja la lista de comentarios. */
  function pintarLista() {
    contador.textContent = comentarios.length ? `(${comentarios.length})` : '';
    if (comentarios.length === 0) {
      lista.replaceChildren(crear('li', { clase: 'dt-vacio', texto: 'Aún no hay comentarios.' }));
      return;
    }
    const conocidos = new Set(mencionables.map((u) => u.usuario));
    lista.replaceChildren(...comentarios.map((c) => crear('li', { clase: 'dt-comentario' }, [
      crear('span', { clase: 'dt-avatar', texto: iniciales(c.autor.nombre), atributos: { 'aria-hidden': 'true' } }),
      crear('div', { clase: 'dt-comentario__contenido' }, [
        crear('div', { clase: 'dt-comentario__cabecera' }, [
          crear('strong', { texto: c.autor.nombre }),
          crear('time', { texto: formatearFecha(c.creadoEn), atributos: { datetime: c.creadoEn } }),
        ]),
        crear('p', { clase: 'dt-comentario__texto' }, [textoConMenciones(c.texto, conocidos)]),
      ]),
    ])));
  }

  /** Carga comentarios y personas mencionables. */
  async function cargar() {
    avisoCarga.ocultar();
    lista.replaceChildren(crear('li', { clase: 'dt-vacio', texto: 'Cargando comentarios…' }));
    try {
      const [respuestaComentarios, respuestaMencionables] = await Promise.all([
        api(`/comentarios/tarea/${tareaId}`),
        api(`/comentarios/tarea/${tareaId}/mencionables`).catch(() => null),
      ]);
      comentarios = respuestaComentarios.datos.comentarios;
      mencionables = respuestaMencionables?.datos?.usuarios ?? [];
      pintarLista();
    } catch (error) {
      lista.replaceChildren();
      avisoCarga.mostrar(
        mensajeError(error, 'No se pudieron cargar los comentarios.'),
        [{ texto: 'Reintentar', alClick: cargar }],
      );
    }
  }

  /** Guarda el texto actual como borrador de esta tarjeta. */
  function guardarBorrador() {
    if (campo.value) borradores.set(tareaId, campo.value);
    else borradores.delete(tareaId);
    caracteres.textContent = `${campo.value.length}/${MAX_COMENTARIO}`;
  }

  /** Publica el comentario. Si falla, el texto se conserva y se ofrece reintentar. */
  async function publicar() {
    if (enviando) return;
    const texto = campo.value.trim();
    if (!texto) {
      avisoEnvio.mostrar('El comentario no puede estar vacío.');
      campo.focus();
      return;
    }

    enviando = true;
    botonPublicar.disabled = true;
    botonPublicar.textContent = 'Publicando…';
    avisoEnvio.ocultar();
    try {
      const respuesta = await api(`/comentarios/tarea/${tareaId}`, { metodo: 'POST', cuerpo: { texto } });
      comentarios.push(respuesta.datos.comentario);
      campo.value = '';
      guardarBorrador();
      pintarLista();
      lista.lastElementChild?.scrollIntoView({ block: 'nearest' });
      alCambiar();
    } catch (error) {
      avisoEnvio.mostrar(
        mensajeError(error, 'No se pudo publicar el comentario. Tu texto se conservó.'),
        [{ texto: 'Reintentar', alClick: publicar }],
      );
    } finally {
      enviando = false;
      botonPublicar.disabled = false;
      botonPublicar.textContent = 'Publicar';
    }
  }

  /* ---------- Menciones ---------- */

  /** @returns {{consulta:string, inicio:number, fin:number}|null} Texto escrito tras "@" junto al cursor. */
  function consultaActual() {
    const posicion = campo.selectionStart ?? campo.value.length;
    const coincidencia = /(^|\s)@([\w.+-]*)$/.exec(campo.value.slice(0, posicion));
    if (!coincidencia) return null;
    return { consulta: coincidencia[2].toLowerCase(), inicio: posicion - coincidencia[2].length - 1, fin: posicion };
  }

  function cerrarSugerencias() {
    sugerencias = [];
    sugerenciasEl.hidden = true;
    campo.setAttribute('aria-expanded', 'false');
    campo.removeAttribute('aria-activedescendant');
  }

  function pintarSugerencias() {
    sugerenciasEl.replaceChildren(...sugerencias.map((usuario, i) => crear('li', {
      clase: `dt-sugerencia${i === indice ? ' dt-sugerencia--activa' : ''}`,
      atributos: { role: 'option', id: `${idCampo}-op-${i}`, 'aria-selected': i === indice ? 'true' : 'false' },
      eventos: { mousedown: (evento) => { evento.preventDefault(); elegir(i); } },
    }, [
      crear('strong', { texto: usuario.nombre }),
      crear('span', { texto: `@${usuario.usuario}` }),
    ])));
    sugerenciasEl.hidden = false;
    campo.setAttribute('aria-expanded', 'true');
    campo.setAttribute('aria-activedescendant', `${idCampo}-op-${indice}`);
  }

  function actualizarSugerencias() {
    const actual = consultaActual();
    if (!actual) { cerrarSugerencias(); return; }
    sugerencias = mencionables
      .filter((u) => !u.esYo && (u.usuario.startsWith(actual.consulta) || u.nombre.toLowerCase().includes(actual.consulta)))
      .slice(0, 6);
    if (sugerencias.length === 0) { cerrarSugerencias(); return; }
    indice = 0;
    pintarSugerencias();
  }

  /** Inserta la mención elegida en la posición del cursor. */
  function elegir(posicionLista) {
    const usuario = sugerencias[posicionLista];
    const actual = consultaActual();
    if (!usuario || !actual) { cerrarSugerencias(); return; }
    const antes = campo.value.slice(0, actual.inicio);
    const despues = campo.value.slice(actual.fin);
    const insercion = `@${usuario.usuario} `;
    campo.value = `${antes}${insercion}${despues}`;
    const cursor = antes.length + insercion.length;
    campo.setSelectionRange(cursor, cursor);
    campo.focus();
    guardarBorrador();
    cerrarSugerencias();
  }

  campo.addEventListener('input', () => {
    guardarBorrador();
    avisoEnvio.ocultar();
    actualizarSugerencias();
  });
  campo.addEventListener('click', actualizarSugerencias);
  campo.addEventListener('blur', cerrarSugerencias);
  campo.addEventListener('keydown', (evento) => {
    if (!sugerenciasEl.hidden) {
      if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
        evento.preventDefault();
        indice = (indice + (evento.key === 'ArrowDown' ? 1 : -1) + sugerencias.length) % sugerencias.length;
        pintarSugerencias();
        return;
      }
      if (evento.key === 'Enter' || evento.key === 'Tab') {
        evento.preventDefault();
        elegir(indice);
        return;
      }
      if (evento.key === 'Escape') {
        evento.preventDefault();
        evento.stopPropagation();
        cerrarSugerencias();
        return;
      }
    }
    if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) {
      evento.preventDefault();
      publicar();
    }
  });

  /* ---------- Estructura ---------- */
  campo.value = borradores.get(tareaId) ?? '';
  caracteres.textContent = `${campo.value.length}/${MAX_COMENTARIO}`;

  contenedor.replaceChildren(
    crear('h3', { clase: 'dt-seccion__titulo' }, ['Comentarios', contador]),
    avisoCarga.nodo,
    lista,
    crear('div', { clase: 'dt-comentarios__formulario' }, [
      crear('label', { clase: 'dt-solo-lectores', texto: 'Escribe un comentario', atributos: { for: idCampo } }),
      crear('div', { clase: 'dt-campo' }, [campo, sugerenciasEl]),
      avisoEnvio.nodo,
      crear('div', { clase: 'dt-fila dt-fila--entre' }, [
        crear('span', {}, [caracteres, ' · Ctrl+Enter para publicar']),
        botonPublicar,
      ]),
    ]),
  );

  cargar();
}