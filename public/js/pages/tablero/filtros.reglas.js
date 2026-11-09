// Responsable: Alfonso - HU-21: reglas puras para filtrar el tablero, agruparlo en carriles y evaluar cambios en vivo
/**
 * @file filtros.reglas.js
 * @description Lógica pura de la HU-21, sin DOM, sin localStorage y sin red, para poder probarla con Jest:
 *   - Normalizar y depurar los filtros guardados (persona, épica, etiqueta, estado y agrupación).
 *   - Filtrar las tareas del tablero sin modificarlas (criterio 6: solo cambia la vista).
 *   - Construir las opciones de los selectores a partir de las tareas, las columnas y los miembros.
 *   - Agrupar las tareas en carriles (swimlanes) por historia o por persona (criterio 2).
 *   - Decidir qué pasa al soltar una tarjeta en otro carril (criterio 4).
 *   - Decidir si una tarjeta que cambió en vivo debe salir de la vista (criterio 5).
 *
 * El "estado" de una tarea es la columna del tablero en la que está (columna_id).
 */

/** Formas de agrupar el tablero. */
export const MODOS_AGRUPACION = Object.freeze({
  NINGUNO: 'ninguno',
  HISTORIA: 'historia',
  PERSONA: 'persona',
});

/** Valor del filtro de persona (y clave de carril) para las tareas sin responsable. */
export const SIN_ASIGNAR = 'sin-asignar';

/** Valor del filtro de épica para las tareas cuya historia no tiene épica. */
export const SIN_EPICA = 'sin-epica';

/** Campos que se consideran filtros; la agrupación no filtra, solo reorganiza. */
const CAMPOS_FILTRO = Object.freeze(['persona', 'epica', 'etiqueta', 'estado']);

/** Filtros sin ningún valor: se muestra todo el tablero en columnas. */
export const FILTROS_VACIOS = Object.freeze({
  persona: '',
  epica: '',
  etiqueta: '',
  estado: '',
  agrupar: MODOS_AGRUPACION.NINGUNO,
});

/** Mensajes que la interfaz muestra cuando un movimiento entre carriles no se permite. */
export const MENSAJES_CARRIL = Object.freeze({
  OTRA_HISTORIA: 'Una tarea no puede cambiar de historia desde el tablero.',
  SIN_RESPONSABLE: 'Desde el tablero no se puede dejar una tarea sin responsable.',
});

const MODOS_VALIDOS = new Set(Object.values(MODOS_AGRUPACION));

/**
 * Convierte un valor a texto sin espacios sobrantes; null y undefined se vuelven cadena vacía.
 * @param {*} valor
 * @returns {string}
 */
function aTexto(valor) {
  return valor === null || valor === undefined ? '' : String(valor).trim();
}

/**
 * Forma comparable de una etiqueta: sin espacios a los lados y en minúsculas.
 * @param {*} etiqueta
 * @returns {string}
 */
export function normalizarEtiqueta(etiqueta) {
  return aTexto(etiqueta).toLowerCase();
}

/**
 * Clave de la persona responsable de la tarea, o SIN_ASIGNAR si no tiene.
 * @param {Object} tarea
 * @returns {string}
 */
export function clavePersona(tarea) {
  const id = aTexto(tarea?.responsable_id);
  return id === '' ? SIN_ASIGNAR : id;
}

/**
 * Clave de la épica de la tarea (vive en su historia), o SIN_EPICA si no tiene.
 * @param {Object} tarea
 * @returns {string}
 */
function claveEpica(tarea) {
  const id = aTexto(tarea?.epica_id);
  return id === '' ? SIN_EPICA : id;
}

/**
 * Etiquetas de la tarea como arreglo de textos no vacíos (tolera null o un valor que no es arreglo).
 * @param {Object} tarea
 * @returns {string[]}
 */
function etiquetasDe(tarea) {
  return Array.isArray(tarea?.etiquetas) ? tarea.etiquetas.map(aTexto).filter(Boolean) : [];
}

/**
 * Deja los filtros en una forma conocida. Sirve para lo leído de localStorage, que puede venir
 * vacío, dañado o de una versión anterior: lo que no se reconoce se descarta.
 *
 * @param {*} entrada - Objeto con los filtros (o cualquier otro valor).
 * @returns {{persona: string, epica: string, etiqueta: string, estado: string, agrupar: string}}
 */
export function normalizarFiltros(entrada) {
  const origen = entrada && typeof entrada === 'object' ? entrada : {};
  const filtros = { ...FILTROS_VACIOS };
  for (const campo of CAMPOS_FILTRO) {
    const valor = origen[campo];
    if (typeof valor === 'string' || typeof valor === 'number') filtros[campo] = aTexto(valor);
  }
  if (MODOS_VALIDOS.has(origen.agrupar)) filtros.agrupar = origen.agrupar;
  return filtros;
}

/**
 * Indica si hay al menos un filtro con valor (la agrupación no cuenta como filtro).
 * @param {Object} filtros
 * @returns {boolean}
 */
export function hayFiltrosActivos(filtros) {
  const f = normalizarFiltros(filtros);
  return CAMPOS_FILTRO.some((campo) => f[campo] !== '');
}

/**
 * Indica si una tarea cumple todos los filtros activos (se combinan con "y").
 * @param {Object} tarea
 * @param {Object} filtros
 * @returns {boolean}
 */
export function cumpleFiltros(tarea, filtros) {
  if (!tarea || typeof tarea !== 'object') return false;
  const f = normalizarFiltros(filtros);
  if (f.persona && clavePersona(tarea) !== f.persona) return false;
  if (f.epica && claveEpica(tarea) !== f.epica) return false;
  if (f.estado && aTexto(tarea.columna_id) !== f.estado) return false;
  if (f.etiqueta) {
    const buscada = normalizarEtiqueta(f.etiqueta);
    if (!etiquetasDe(tarea).some((e) => normalizarEtiqueta(e) === buscada)) return false;
  }
  return true;
}

/**
 * Devuelve un arreglo nuevo con las tareas que cumplen los filtros. No modifica las tareas
 * recibidas ni el arreglo original (criterio 6).
 *
 * @param {Object[]} tareas
 * @param {Object} filtros
 * @returns {Object[]}
 */
export function filtrarTareas(tareas, filtros) {
  if (!Array.isArray(tareas)) return [];
  return tareas.filter((tarea) => cumpleFiltros(tarea, filtros));
}

/**
 * Ordena opciones por su etiqueta visible, en español y sin distinguir mayúsculas.
 * @param {{valor: string, etiqueta: string}[]} opciones
 * @returns {{valor: string, etiqueta: string}[]}
 */
function ordenarOpciones(opciones) {
  return opciones.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { sensitivity: 'base' }));
}

/**
 * Personas que pueden aparecer en el filtro y en los carriles: los miembros activos del proyecto
 * más quien sea responsable de alguna tarea aunque ya no esté activo.
 *
 * @param {Object[]} tareas
 * @param {Object[]} miembros - Miembros del proyecto ({usuario_id, nombre, activo}).
 * @returns {{valor: string, etiqueta: string}[]} Ordenadas por nombre, sin "Sin asignar".
 */
function listarPersonas(tareas, miembros) {
  const personas = new Map();
  for (const miembro of Array.isArray(miembros) ? miembros : []) {
    const id = aTexto(miembro?.usuario_id ?? miembro?.id);
    if (id && miembro.activo !== false) personas.set(id, { valor: id, etiqueta: aTexto(miembro.nombre) || `Usuario #${id}` });
  }
  for (const tarea of tareas) {
    const id = clavePersona(tarea);
    if (id === SIN_ASIGNAR || personas.has(id)) continue;
    const nombre = aTexto(tarea.responsable) || `Usuario #${id}`;
    personas.set(id, { valor: id, etiqueta: tarea.responsable_inactivo ? `${nombre} (inactivo)` : nombre });
  }
  return ordenarOpciones([...personas.values()]);
}

/**
 * Construye las opciones de los selectores de filtro.
 *
 * @param {Object[]} tareas - Tareas del tablero.
 * @param {Object} [catalogos]
 * @param {Object[]} [catalogos.columnas] - Columnas del tablero en su orden ({id, nombre}).
 * @param {Object[]} [catalogos.miembros] - Miembros del proyecto ({usuario_id, nombre, activo}).
 * @returns {{personas: Object[], epicas: Object[], etiquetas: Object[], estados: Object[]}}
 */
export function construirOpciones(tareas, { columnas = [], miembros = [] } = {}) {
  const lista = Array.isArray(tareas) ? tareas : [];

  const personas = listarPersonas(lista, miembros);
  if (lista.some((t) => clavePersona(t) === SIN_ASIGNAR)) personas.push({ valor: SIN_ASIGNAR, etiqueta: 'Sin asignar' });

  const epicasMapa = new Map();
  let haySinEpica = false;
  for (const tarea of lista) {
    const id = claveEpica(tarea);
    if (id === SIN_EPICA) haySinEpica = true;
    else if (!epicasMapa.has(id)) epicasMapa.set(id, { valor: id, etiqueta: aTexto(tarea.epica_nombre) || `Épica #${id}` });
  }
  const epicas = ordenarOpciones([...epicasMapa.values()]);
  if (haySinEpica) epicas.push({ valor: SIN_EPICA, etiqueta: 'Sin épica' });

  // Una sola opción por etiqueta aunque se haya escrito con distintas mayúsculas; se muestra la primera forma vista
  const etiquetasMapa = new Map();
  for (const tarea of lista) {
    for (const etiqueta of etiquetasDe(tarea)) {
      const clave = normalizarEtiqueta(etiqueta);
      if (!etiquetasMapa.has(clave)) etiquetasMapa.set(clave, { valor: clave, etiqueta });
    }
  }
  const etiquetas = ordenarOpciones([...etiquetasMapa.values()]);

  const estados = (Array.isArray(columnas) ? columnas : [])
    .filter((c) => aTexto(c?.id) !== '')
    .map((c) => ({ valor: aTexto(c.id), etiqueta: aTexto(c.nombre) || `Columna #${c.id}` }));

  return { personas, epicas, etiquetas, estados };
}

/**
 * Quita de los filtros los valores que ya no existen entre las opciones (por ejemplo, una persona
 * que salió del proyecto o una columna eliminada). Así un filtro guardado no deja el tablero vacío
 * sin que el selector muestre por qué.
 *
 * @param {Object} filtros
 * @param {{personas: Object[], epicas: Object[], etiquetas: Object[], estados: Object[]}} opciones
 * @returns {{filtros: Object, descartados: string[]}} Filtros válidos y nombres de los campos que se limpiaron.
 */
export function depurarFiltros(filtros, opciones) {
  const resultado = normalizarFiltros(filtros);
  const listas = { persona: opciones?.personas, epica: opciones?.epicas, etiqueta: opciones?.etiquetas, estado: opciones?.estados };
  const descartados = [];
  for (const campo of CAMPOS_FILTRO) {
    if (resultado[campo] === '') continue;
    const valores = (listas[campo] || []).map((o) => o.valor);
    const valor = campo === 'etiqueta' ? normalizarEtiqueta(resultado[campo]) : resultado[campo];
    if (valores.includes(valor)) {
      // La etiqueta se guarda en su forma comparable, que es el valor de la opción en el selector
      resultado[campo] = valor;
    } else {
      resultado[campo] = '';
      descartados.push(campo);
    }
  }
  return { filtros: resultado, descartados };
}

/**
 * Agrupa las tareas en carriles horizontales.
 *   - Por historia: un carril por historia con tareas, ordenados por número de HU.
 *   - Por persona: un carril por persona del proyecto (aunque no tenga tareas, para poder soltarle
 *     una tarjeta) y "Sin asignar" al final si hay tareas sin responsable. Si hay un filtro de persona,
 *     solo se muestra el carril de esa persona.
 *
 * @param {Object[]} tareas - Tareas ya filtradas.
 * @param {string} modo - Uno de MODOS_AGRUPACION.
 * @param {Object} [opciones]
 * @param {Object[]} [opciones.miembros] - Miembros del proyecto ({usuario_id, nombre, activo}).
 * @param {string} [opciones.personaFiltrada] - Valor del filtro de persona activo.
 * @returns {{clave: string, titulo: string, responsableId: number|null, tareas: Object[]}[]}
 *          Arreglo vacío si el modo es "ninguno" o desconocido.
 */
export function agruparEnCarriles(tareas, modo, { miembros = [], personaFiltrada = '' } = {}) {
  const lista = Array.isArray(tareas) ? tareas : [];

  if (modo === MODOS_AGRUPACION.HISTORIA) {
    const carriles = new Map();
    for (const tarea of lista) {
      const clave = aTexto(tarea.historia_id) || 'sin-historia';
      if (!carriles.has(clave)) {
        const numero = Number(tarea.numero_hu);
        const nombre = aTexto(tarea.historia_titulo);
        const titulo = Number.isInteger(numero) && numero > 0
          ? `HU-${numero}${nombre ? ` · ${nombre}` : ''}`
          : nombre || (clave === 'sin-historia' ? 'Sin historia' : `Historia #${clave}`);
        carriles.set(clave, { clave, titulo, orden: Number.isInteger(numero) ? numero : Infinity, responsableId: null, tareas: [] });
      }
      carriles.get(clave).tareas.push(tarea);
    }
    return [...carriles.values()]
      .sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo, 'es'))
      .map(({ orden, ...carril }) => carril);
  }

  if (modo === MODOS_AGRUPACION.PERSONA) {
    const filtro = aTexto(personaFiltrada);
    const carriles = listarPersonas(lista, miembros).map((p) => ({
      clave: p.valor,
      titulo: p.etiqueta,
      responsableId: Number(p.valor),
      tareas: [],
    }));
    const sinAsignar = { clave: SIN_ASIGNAR, titulo: 'Sin asignar', responsableId: null, tareas: [] };
    const porClave = new Map(carriles.map((c) => [c.clave, c]));
    for (const tarea of lista) {
      const clave = clavePersona(tarea);
      (clave === SIN_ASIGNAR ? sinAsignar : porClave.get(clave)).tareas.push(tarea);
    }
    if (sinAsignar.tareas.length > 0 || filtro === SIN_ASIGNAR) carriles.push(sinAsignar);
    return filtro ? carriles.filter((c) => c.clave === filtro) : carriles;
  }

  return [];
}

/**
 * Decide qué hacer cuando una tarjeta se suelta en un carril.
 *
 * @param {string} modo - Agrupación vigente.
 * @param {string} carrilOrigen - Clave del carril de donde salió la tarjeta.
 * @param {string} carrilDestino - Clave del carril donde se soltó.
 * @returns {{tipo: 'normal'}|{tipo: 'rechazar', mensaje: string}|{tipo: 'reasignar', responsableId: number}}
 *   "normal": el movimiento es entre columnas del mismo carril (lo maneja el arrastre del tablero).
 *   "rechazar": no se permite; "reasignar": se debe pedir confirmación para cambiar el responsable.
 */
export function decidirMovimientoEntreCarriles(modo, carrilOrigen, carrilDestino) {
  const origen = aTexto(carrilOrigen);
  const destino = aTexto(carrilDestino);
  if (!MODOS_VALIDOS.has(modo) || modo === MODOS_AGRUPACION.NINGUNO || !origen || !destino || origen === destino) {
    return { tipo: 'normal' };
  }
  if (modo === MODOS_AGRUPACION.HISTORIA) return { tipo: 'rechazar', mensaje: MENSAJES_CARRIL.OTRA_HISTORIA };
  const responsableId = Number(destino);
  if (destino === SIN_ASIGNAR || !Number.isInteger(responsableId) || responsableId <= 0) {
    return { tipo: 'rechazar', mensaje: MENSAJES_CARRIL.SIN_RESPONSABLE };
  }
  return { tipo: 'reasignar', responsableId };
}

/**
 * Devuelve una copia de la tarea con los datos que trae un aviso en vivo (evento de socket).
 * Solo toma los campos presentes en el aviso; no modifica la tarea recibida.
 *
 * @param {Object} tarea - Tarea como la conoce el tablero.
 * @param {Object} datos - Datos del evento ({columnaId, responsableId, responsable, ...}).
 * @returns {Object}
 */
export function aplicarCambioEnVivo(tarea, datos = {}) {
  const copia = { ...tarea };
  if (!datos || typeof datos !== 'object') return copia;
  if (datos.columnaId !== undefined) copia.columna_id = datos.columnaId;
  if (datos.version !== undefined) copia.version = datos.version;
  if (datos.orden !== undefined) copia.orden = datos.orden;
  if (datos.responsableId !== undefined) {
    copia.responsable_id = datos.responsableId;
    copia.responsable = datos.responsable ?? null;
    copia.responsable_inactivo = false;
  }
  if (Array.isArray(datos.etiquetas)) copia.etiquetas = [...datos.etiquetas];
  return copia;
}

/**
 * Compara una tarea antes y después de un cambio en vivo contra los filtros activos.
 *
 * @param {Object|null} antes - Tarea antes del cambio (null si el tablero no la conocía).
 * @param {Object|null} despues - Tarea después del cambio (null si se eliminó).
 * @param {Object} filtros
 * @returns {{visibleAntes: boolean, visibleDespues: boolean, accion: 'ocultar'|'mostrar'|'actualizar'|'ninguna'}}
 *   "ocultar": estaba a la vista y ya no cumple el filtro (criterio 5: sacarla con un aviso discreto).
 */
export function evaluarCambioEnVivo(antes, despues, filtros) {
  const visibleAntes = cumpleFiltros(antes, filtros);
  const visibleDespues = cumpleFiltros(despues, filtros);
  let accion = 'ninguna';
  if (visibleAntes && !visibleDespues) accion = 'ocultar';
  else if (!visibleAntes && visibleDespues) accion = 'mostrar';
  else if (visibleAntes && visibleDespues) accion = 'actualizar';
  return { visibleAntes, visibleDespues, accion };
}
