// Responsable: Alfonso - HU-28: horas estimadas contra reales y semaforo
/**
 * @file desviacion.js
 * @description Componente autocontenido de la HU-28: horas estimadas contra reales y su desviación
 * (h y %) por tarea, historia, persona y sprint, con semáforo 10 / 25 %, "N/A", "Sin registro" y "Ahorro".
 * Todo el cálculo lo hace el servidor (GET /api/desviacion/...); aquí solo se presenta.
 * Se refresca en vivo con el evento `horas:actualizadas` que emite el módulo de horas (HU-27).
 *
 * Uso desde metricas.js:
 *   import { iniciarDesviacion } from './metricas/desviacion.js';
 *   const desviacion = iniciarDesviacion({ contenedor: document.getElementById('desviacion-contenido'), proyectoId });
 *   // Al cambiar de proyecto: desviacion.destruir(); y volver a llamar a iniciarDesviacion.
 *
 * Los textos que vienen del usuario (títulos, nombres) se insertan siempre con textContent, nunca con innerHTML.
 */

import { api } from '../../core/api.js';
import { pluralizar } from '../../core/utils.js';

/** Hoja de estilos propia; se agrega una sola vez para que la página no tenga que enlazarla. */
const HOJA_ESTILOS = '/css/pages/desviacion.css';

/** Cliente de Socket.io que sirve el propio servidor. */
const URL_CLIENTE_SOCKET = '/socket.io/socket.io.js';

/** Evento que emite el módulo de horas (HU-27) a la sala del proyecto. */
const EVENTO_HORAS = 'horas:actualizadas';

/** Espera antes de recargar para juntar varios registros seguidos en una sola petición. */
const ESPERA_RECARGA_MS = 400;

/** Signo menos tipográfico para los ahorros. */
const MENOS = '−';

/** Coma decimal estilo español y máximo 2 decimales: 1,5 · 18,75. */
const FORMATO = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: false });

/** Niveles del selector, en el orden en que se muestran. */
const NIVELES = [
  { clave: 'tareas', etiqueta: 'Tarea', columna: 'Tarea' },
  { clave: 'historias', etiqueta: 'Historia', columna: 'Historia' },
  { clave: 'personas', etiqueta: 'Persona', columna: 'Persona' },
  { clave: 'sprint', etiqueta: 'Sprint', columna: 'Sprint' },
];

/**
 * Presentación de cada estado. El color nunca va solo: cada insignia lleva icono y texto.
 * El ahorro usa celeste (info) para distinguirse del semáforo verde / ámbar / rojo.
 */
const ESTADOS = {
  ok: { texto: 'OK', icono: '✓', clase: 'insignia--exito' },
  alerta: { texto: 'Alerta', icono: '▲', clase: 'insignia--advertencia' },
  critico: { texto: 'Crítico', icono: '✕', clase: 'insignia--peligro' },
  ahorro: { texto: 'Ahorro', icono: '↓', clase: 'insignia--info' },
  na: { texto: 'N/A', icono: '–', clase: 'insignia--neutro' },
  'sin-registro': { texto: 'Sin registro', icono: '○', clase: 'insignia--neutro' },
};

/** Estado de un grupo (historia, persona o sprint) que todavía no tiene tareas. */
const SIN_TAREAS = { texto: 'Sin tareas', icono: '○', clase: 'insignia--neutro' };

/** Contador para ids únicos si la página monta el componente más de una vez. */
let instancias = 0;

/** Promesa compartida de carga del cliente de Socket.io. */
let promesaClienteSocket = null;

/*
 * Utilidades
 */

/**
 * Crea un elemento con clase, texto y atributos. El texto se asigna con textContent (seguro ante XSS).
 * @param {string} etiqueta Nombre de la etiqueta.
 * @param {{clase?:string, texto?:string, atributos?:Object<string,string>}} [opciones]
 * @param {Array<Node|null|false>} [hijos] Nodos hijos (se ignoran los vacíos).
 * @returns {HTMLElement}
 */
function crear(etiqueta, { clase, texto, atributos = {} } = {}, hijos = []) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined && texto !== null) el.textContent = texto;
  Object.entries(atributos).forEach(([nombre, valor]) => el.setAttribute(nombre, valor));
  hijos.filter(Boolean).forEach((hijo) => el.append(hijo));
  return el;
}

/**
 * Agrega la hoja de estilos del componente si la página aún no la tiene.
 * @returns {void}
 */
function asegurarEstilos() {
  if (document.querySelector(`link[href="${HOJA_ESTILOS}"]`)) return;
  document.head.append(crear('link', { atributos: { rel: 'stylesheet', href: HOJA_ESTILOS } }));
}

/**
 * Carga el cliente de Socket.io una sola vez. Si no está disponible, el componente funciona sin tiempo real.
 * @returns {Promise<Function|null>} La función `io`, o null.
 */
function cargarClienteSocket() {
  if (typeof window.io === 'function') return Promise.resolve(window.io);
  if (!promesaClienteSocket) {
    promesaClienteSocket = new Promise((resolver) => {
      const script = crear('script', { atributos: { src: URL_CLIENTE_SOCKET } });
      script.onload = () => resolver(typeof window.io === 'function' ? window.io : null);
      script.onerror = () => resolver(null);
      document.head.append(script);
    });
  }
  return promesaClienteSocket;
}

/**
 * Formatea horas sin signo: "9,5 h".
 * @param {number} horas Horas.
 * @returns {string}
 */
const formatearHoras = (horas) => `${FORMATO.format(horas)} h`;

/**
 * Formatea un número con signo explícito: "+1,5", "−2", "0".
 * @param {number} valor Número.
 * @returns {string}
 */
function conSigno(valor) {
  if (valor > 0) return `+${FORMATO.format(valor)}`;
  if (valor < 0) return `${MENOS}${FORMATO.format(Math.abs(valor))}`;
  return '0';
}

/**
 * Texto de la desviación en horas: "+1,5 h", o "—" si no aplica.
 * @param {{desviacionHoras:number|null}} d Desviación del servidor.
 * @returns {string}
 */
const textoHoras = (d) => (d.desviacionHoras === null ? '—' : `${conSigno(d.desviacionHoras)} h`);

/**
 * Texto de la desviación en porcentaje: "+18,75 %", "N/A" si no hay estimado, o "—" sin registro.
 * @param {{desviacionPorcentaje:number|null, estado:string}} d Desviación del servidor.
 * @returns {string}
 */
function textoPorcentaje(d) {
  if (d.estado === 'na') return 'N/A';
  if (d.desviacionPorcentaje === null) return '—';
  return `${conSigno(d.desviacionPorcentaje)} %`;
}

/**
 * Texto completo de la desviación, por ejemplo "+1,5 h · +18,75 %".
 * @param {Object} d Desviación del servidor.
 * @returns {string}
 */
function textoDesviacion(d) {
  if (d.estado === 'sin-registro') return 'Sin registro';
  return `${textoHoras(d)} · ${textoPorcentaje(d)}`;
}

/**
 * Indica si un grupo (historia, persona o sprint) no tiene ninguna tarea.
 * @param {Object} d Elemento del servidor.
 * @returns {boolean}
 */
const esGrupoVacio = (d) => d.totalTareas === 0;

/**
 * Crea la insignia del estado (icono + texto + color).
 * @param {Object} d Elemento del servidor.
 * @returns {HTMLElement}
 */
function insigniaEstado(d) {
  const info = esGrupoVacio(d) ? SIN_TAREAS : (ESTADOS[d.estado] ?? ESTADOS['sin-registro']);
  return crear('span', { clase: `insignia ${info.clase}` }, [
    crear('span', { texto: info.icono, atributos: { 'aria-hidden': 'true' } }),
    document.createTextNode(info.texto),
  ]);
}

/**
 * Texto del aviso de tareas excluidas del cálculo, o cadena vacía si no hay.
 * @param {{tareasSinRegistro:number}} d Resumen o grupo.
 * @returns {string}
 */
function textoExcluidas(d) {
  const n = d.tareasSinRegistro ?? 0;
  if (n === 0) return '';
  return `${n} ${pluralizar(n, 'tarea sin horas registradas no se incluyó', 'tareas sin horas registradas no se incluyeron')} en el cálculo.`;
}

/**
 * Convierte un error de api() en un mensaje para la persona.
 * @param {Error & {estado?:number, cuerpo?:{mensaje?:string}}} error Error lanzado por api().
 * @returns {string}
 */
function mensajeDeError(error) {
  if (error.estado === 403) return error.cuerpo?.mensaje || 'No tienes permiso para ver la desviación de horas.';
  if (error.estado === 404) return 'No se encontró el sprint o el proyecto. Elige otro sprint o vuelve a cargar la página.';
  if (error.estado === 401) return 'Tu sesión terminó. Inicia sesión de nuevo.';
  return error.cuerpo?.mensaje || 'No se pudo cargar la desviación de horas. Revisa tu conexión e inténtalo de nuevo.';
}

/*
 * Componente
 */

/**
 * Monta el componente de desviación de horas dentro del contenedor.
 *
 * @param {Object} opciones
 * @param {HTMLElement} opciones.contenedor Elemento donde se dibuja (se vacía).
 * @param {number} opciones.proyectoId Proyecto a consultar.
 * @param {number|null} [opciones.sprintId] Sprint inicial; si falta se usa el activo (o el más reciente).
 * @param {boolean} [opciones.mostrarSelector=true] Mostrar el selector de sprint propio del componente.
 * @returns {{recargar: function(): Promise<void>, cambiarSprint: function(number): Promise<void>, destruir: function(): void}}
 */
export function iniciarDesviacion({ contenedor, proyectoId, sprintId = null, mostrarSelector = true }) {
  if (!contenedor) throw new Error('iniciarDesviacion: falta el contenedor.');
  asegurarEstilos();

  const prefijo = `desv-${++instancias}`;
  const estado = {
    proyectoId: Number(proyectoId),
    sprintId: Number(sprintId) || null,
    nivel: 'tareas',
    datos: null,
    peticion: 0,
    controlador: null,
    socket: null,
    temporizador: null,
    destruido: false,
  };

  // Estructura fija; las zonas internas se rellenan según el estado
  const selectSprint = crear('select', { atributos: { id: `${prefijo}-sprint` } });
  const barra = crear('div', { clase: 'desv-barra' }, [
    crear('label', { clase: 'desv-filtro', texto: 'Sprint', atributos: { for: `${prefijo}-sprint` } }, [selectSprint]),
  ]);
  barra.hidden = true;
  const vivo = crear('p', { clase: 'desv-solo-lectores', atributos: { 'aria-live': 'polite', role: 'status' } });
  const resumen = crear('div', { clase: 'desv-resumen', atributos: { 'aria-label': 'Resumen del sprint' } });
  const aviso = crear('p', { clase: 'desv-aviso', atributos: { role: 'note' } });
  aviso.hidden = true;
  const pestanas = crear('div', { clase: 'desv-pestanas', atributos: { role: 'tablist', 'aria-label': 'Nivel de detalle' } });
  const panel = crear('div', { atributos: { role: 'tabpanel', id: `${prefijo}-panel`, tabindex: '-1' } });

  const botonesNivel = NIVELES.map((nivel) => {
    const boton = crear('button', {
      clase: 'desv-pestana',
      texto: nivel.etiqueta,
      atributos: {
        type: 'button', role: 'tab', id: `${prefijo}-tab-${nivel.clave}`,
        'aria-controls': `${prefijo}-panel`, 'data-nivel': nivel.clave,
      },
    });
    pestanas.append(boton);
    return boton;
  });

  contenedor.replaceChildren(crear('div', { clase: 'desv' }, [barra, vivo, resumen, aviso, pestanas, panel]));

  /**
   * Marca la pestaña activa (roving tabindex: solo la activa entra en el orden de tabulación).
   * @returns {void}
   */
  function marcarPestana() {
    botonesNivel.forEach((boton) => {
      const activa = boton.dataset.nivel === estado.nivel;
      boton.setAttribute('aria-selected', String(activa));
      boton.tabIndex = activa ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `${prefijo}-tab-${estado.nivel}`);
  }

  /**
   * Muestra u oculta las zonas de datos (resumen, aviso y pestañas).
   * @param {boolean} visibles
   * @returns {void}
   */
  function zonasDatos(visibles) {
    resumen.hidden = !visibles;
    pestanas.hidden = !visibles;
    if (!visibles) aviso.hidden = true;
  }

  /**
   * Esqueleto de carga en el resumen y en la tabla.
   * @returns {void}
   */
  function mostrarCarga() {
    contenedor.setAttribute('aria-busy', 'true');
    zonasDatos(true);
    resumen.replaceChildren(...[1, 2, 3].map(() => crear('span', { clase: 'esqueleto desv-esqueleto--kpi' })));
    panel.replaceChildren(...[1, 2, 3, 4].map(() => crear('span', { clase: 'esqueleto desv-esqueleto--fila' })));
  }

  /**
   * Mensaje de vacío claro.
   * @param {string} titulo Título del aviso.
   * @param {string} texto Explicación.
   * @param {boolean} [conResumen=false] Conservar el resumen y las pestañas visibles.
   * @returns {void}
   */
  function mostrarVacio(titulo, texto, conResumen = false) {
    if (!conResumen) zonasDatos(false);
    panel.replaceChildren(crear('div', { clase: 'aviso--vacio desv-vacio' }, [
      crear('p', { clase: 'aviso__titulo', texto: titulo }),
      crear('p', { clase: 'aviso__texto', texto }),
    ]));
  }

  /**
   * Error con botón "Reintentar".
   * @param {Error} error Error de api().
   * @returns {void}
   */
  function mostrarError(error) {
    zonasDatos(false);
    const boton = crear('button', { clase: 'boton boton--secundario boton--pequeno', texto: 'Reintentar', atributos: { type: 'button' } });
    boton.addEventListener('click', () => cargar());
    const alerta = crear('div', { clase: 'alerta alerta--error desv-error', atributos: { role: 'alert' } }, [
      crear('span', { texto: mensajeDeError(error) }),
      error.estado === 403 ? null : boton,
    ]);
    panel.replaceChildren(alerta);
  }

  /**
   * Tarjeta resumen.
   * @param {string} etiqueta Título.
   * @param {string} valor Valor principal.
   * @param {Node|null} [pie] Contenido inferior (insignia).
   * @param {string} [claseValor] Clase extra del valor.
   * @returns {HTMLElement}
   */
  function tarjeta(etiqueta, valor, pie = null, claseValor = '') {
    return crear('article', { clase: 'desv-kpi' }, [
      crear('span', { clase: 'desv-kpi__etiqueta', texto: etiqueta }),
      crear('span', { clase: `desv-kpi__valor ${claseValor}`.trim(), texto: valor }),
      pie ? crear('div', { clase: 'desv-kpi__pie' }, [pie]) : null,
    ]);
  }

  /**
   * Dibuja las tarjetas resumen del sprint y el aviso de tareas excluidas.
   * @param {Object} r Resumen del servidor.
   * @returns {void}
   */
  function dibujarResumen(r) {
    const sinTareas = esGrupoVacio(r);
    resumen.replaceChildren(
      tarjeta('Horas estimadas', sinTareas ? '—' : formatearHoras(r.horasEstimadas)),
      tarjeta('Horas reales', sinTareas ? '—' : formatearHoras(r.horasReales)),
      tarjeta('Desviación del sprint', sinTareas ? 'Sin tareas' : textoDesviacion(r), insigniaEstado(r), `desv-valor desv-valor--${r.estado}`),
    );
    const texto = textoExcluidas(r);
    aviso.textContent = texto;
    aviso.hidden = !texto;
  }

  /**
   * Celda del nombre con su detalle (historia y responsable, tareas excluidas, usuario inactivo).
   * @param {Object} e Elemento del servidor.
   * @returns {HTMLElement} Celda <th scope="row">.
   */
  function celdaNombre(e) {
    const nombre = crear('span', { clase: 'desv-nombre', texto: e.nombre });
    if (estado.nivel === 'personas' && e.activo === false) {
      nombre.append(crear('span', { clase: 'insignia insignia--neutro', texto: 'Usuario inactivo' }));
    }

    const detalles = [];
    if (estado.nivel === 'tareas') {
      detalles.push(e.historia, e.responsable ? `Responsable: ${e.responsable}` : 'Sin responsable');
    } else if (!esGrupoVacio(e) && e.tareasSinRegistro > 0) {
      detalles.push(`${e.tareasConsideradas} de ${e.totalTareas} ${pluralizar(e.totalTareas, 'tarea', 'tareas')} con horas registradas`);
    }

    return crear('th', { atributos: { scope: 'row' } }, [
      nombre,
      detalles.length ? crear('span', { clase: 'desv-detalle', texto: detalles.filter(Boolean).join(' · ') }) : null,
    ]);
  }

  /**
   * Fila de la tabla.
   * @param {Object} e Elemento del servidor.
   * @returns {HTMLTableRowElement}
   */
  function fila(e) {
    const vacio = esGrupoVacio(e);
    const sinRegistro = e.estado === 'sin-registro';
    const claseValor = `desv-num desv-valor desv-valor--${e.estado}`;
    return crear('tr', { clase: e.activo === false ? 'desv-fila--inactiva' : '' }, [
      celdaNombre(e),
      crear('td', { clase: 'desv-num', texto: vacio || sinRegistro ? '—' : formatearHoras(e.horasEstimadas) }),
      crear('td', { clase: 'desv-num', texto: vacio || sinRegistro ? '—' : formatearHoras(e.horasReales) }),
      crear('td', { clase: claseValor, texto: textoHoras(e) }),
      crear('td', { clase: claseValor, texto: textoPorcentaje(e) }),
      crear('td', {}, [insigniaEstado(e)]),
    ]);
  }

  /**
   * Dibuja la tabla del nivel activo.
   * @param {Object[]} elementos Filas del servidor.
   * @returns {void}
   */
  function dibujarTabla(elementos) {
    const nivel = NIVELES.find((n) => n.clave === estado.nivel);
    const encabezados = [nivel.columna, 'Est.', 'Real', 'Desv. (h)', 'Desv. (%)', 'Estado'];
    const titulos = { 'Est.': 'Horas estimadas', Real: 'Horas reales' };

    const tabla = crear('table', { clase: 'desv-tabla' }, [
      crear('caption', { texto: `Desviación por ${nivel.etiqueta.toLowerCase()} en ${estado.datos.sprint.nombre}` }),
      crear('thead', {}, [crear('tr', {}, encabezados.map((texto) => crear('th', {
        texto,
        atributos: titulos[texto] ? { scope: 'col', title: titulos[texto] } : { scope: 'col' },
      })))]),
      crear('tbody', {}, elementos.map(fila)),
    ]);

    // La envoltura se puede enfocar para desplazar la tabla con el teclado en pantallas angostas
    panel.replaceChildren(
      crear('p', {
        clase: 'desv-leyenda',
        texto: 'Verde hasta 10 %, ámbar hasta 25 % y rojo arriba de 25 %. El ahorro se muestra en celeste con signo menos.',
      }),
      crear('div', {
        clase: 'desv-tabla-envoltura',
        atributos: { tabindex: '0', role: 'region', 'aria-label': `Tabla de desviación por ${nivel.etiqueta.toLowerCase()}` },
      }, [tabla]),
    );
  }

  /**
   * Dibuja la vista completa con los datos ya cargados.
   * @returns {void}
   */
  function dibujar() {
    const { resumen: r, elementos } = estado.datos;
    zonasDatos(true);
    dibujarResumen(r);

    if (esGrupoVacio(r)) {
      mostrarVacio('Este sprint aún no tiene tareas', 'Cuando se agreguen tareas con horas estimadas y se registren horas reales, aquí verás su desviación.', true);
      pestanas.hidden = true;
      return;
    }
    if (estado.nivel === 'sprint') {
      dibujarTabla([r]);
      return;
    }
    if (!elementos || elementos.length === 0) {
      mostrarVacio('Sin datos para este nivel', 'No hay elementos que mostrar en este sprint.', true);
      return;
    }
    dibujarTabla(elementos);
  }

  /**
   * Llena el selector de sprints.
   * @param {Array<{id:number, nombre:string, estado:string}>} sprints Sprints del proyecto.
   * @returns {void}
   */
  function llenarSelector(sprints) {
    selectSprint.replaceChildren(...sprints.map((s) => crear('option', {
      texto: `${s.nombre} (${s.estado})`,
      atributos: { value: String(s.id) },
    })));
    selectSprint.value = String(estado.sprintId);
    barra.hidden = !mostrarSelector || sprints.length === 0;
  }

  /**
   * Pide los datos al servidor y dibuja. Cancela la petición anterior si sigue en curso.
   * @param {{silencioso?: boolean}} [opciones] silencioso = recarga en vivo, sin esqueleto ni error invasivo.
   * @returns {Promise<void>}
   */
  async function cargar({ silencioso = false } = {}) {
    if (estado.destruido) return;
    estado.controlador?.abort();
    const controlador = new AbortController();
    estado.controlador = controlador;
    const numero = ++estado.peticion;
    if (!silencioso) {
      vivo.textContent = '';
      mostrarCarga();
    }

    try {
      const base = `/desviacion/proyectos/${estado.proyectoId}/sprints`;

      // Sin sprint elegido (o primera carga): pedir la lista y usar el sugerido
      if (!estado.sprintId || selectSprint.options.length === 0) {
        const { datos } = await api(base, { signal: controlador.signal });
        if (numero !== estado.peticion) return;
        if (!estado.sprintId || !datos.sprints.some((s) => s.id === estado.sprintId)) estado.sprintId = datos.sugeridoId;
        if (!estado.sprintId) {
          barra.hidden = true;
          mostrarVacio('Este proyecto aún no tiene sprints', 'Planifica un sprint para comparar las horas estimadas con las reales.');
          return;
        }
        llenarSelector(datos.sprints);
      }

      const ruta = estado.nivel === 'sprint' ? `${base}/${estado.sprintId}` : `${base}/${estado.sprintId}/${estado.nivel}`;
      const { datos } = await api(ruta, { signal: controlador.signal });
      if (numero !== estado.peticion || estado.destruido) return;
      estado.datos = datos;
      dibujar();
      if (silencioso) vivo.textContent = 'Se registraron horas nuevas: la desviación se actualizó.';
    } catch (error) {
      if (error.name === 'AbortError' || numero !== estado.peticion || estado.destruido) return;
      // En una recarga en vivo se conserva lo que ya se veía; solo se avisa a lectores de pantalla
      if (silencioso && estado.datos) {
        vivo.textContent = 'No se pudo actualizar la desviación; se muestran los últimos datos.';
        return;
      }
      mostrarError(error);
    } finally {
      if (numero === estado.peticion) contenedor.removeAttribute('aria-busy');
    }
  }

  /**
   * Cambia de nivel y recarga.
   * @param {string} nivel Clave del nivel.
   * @param {boolean} [enfocar=false] Mover el foco a la pestaña (navegación con flechas).
   * @returns {void}
   */
  function elegirNivel(nivel, enfocar = false) {
    if (nivel === estado.nivel) return;
    estado.nivel = nivel;
    marcarPestana();
    if (enfocar) botonesNivel.find((b) => b.dataset.nivel === nivel)?.focus();
    cargar();
  }

  /**
   * Junta varios avisos de horas seguidos en una sola recarga silenciosa.
   * @returns {void}
   */
  function programarRecarga() {
    clearTimeout(estado.temporizador);
    estado.temporizador = setTimeout(() => cargar({ silencioso: true }), ESPERA_RECARGA_MS);
  }

  /**
   * Se une a la sala del proyecto y escucha los cambios de horas.
   * @returns {Promise<void>}
   */
  async function conectarTiempoReal() {
    try {
      const io = await cargarClienteSocket();
      if (!io || estado.destruido) return;
      const socket = io({ withCredentials: true });
      estado.socket = socket;
      socket.on('connect', () => socket.emit('unirse_proyecto', estado.proyectoId));
      socket.on(EVENTO_HORAS, programarRecarga);
    } catch {
      // Sin tiempo real: el componente sigue funcionando con "Reintentar" y recargar()
    }
  }

  // Eventos de la interfaz
  pestanas.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-nivel]');
    if (boton) elegirNivel(boton.dataset.nivel);
  });

  pestanas.addEventListener('keydown', (evento) => {
    const actual = NIVELES.findIndex((n) => n.clave === estado.nivel);
    const destino = {
      ArrowRight: (actual + 1) % NIVELES.length,
      ArrowLeft: (actual - 1 + NIVELES.length) % NIVELES.length,
      Home: 0,
      End: NIVELES.length - 1,
    }[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    elegirNivel(NIVELES[destino].clave, true);
  });

  selectSprint.addEventListener('change', () => {
    estado.sprintId = Number(selectSprint.value) || null;
    cargar();
  });

  marcarPestana();
  cargar();
  conectarTiempoReal();

  return {
    /** Vuelve a pedir los datos (por ejemplo, desde otro componente de la página). */
    recargar: () => cargar(),
    /** Muestra otro sprint del mismo proyecto. */
    cambiarSprint: (id) => {
      estado.sprintId = Number(id) || null;
      if (estado.sprintId) selectSprint.value = String(estado.sprintId);
      return cargar();
    },
    /** Libera el socket y los temporizadores; llamarlo antes de quitar el componente o cambiar de proyecto. */
    destruir: () => {
      estado.destruido = true;
      estado.controlador?.abort();
      clearTimeout(estado.temporizador);
      if (estado.socket) {
        estado.socket.emit('salir_proyecto', estado.proyectoId);
        estado.socket.disconnect();
      }
      contenedor.replaceChildren();
    },
  };
}
