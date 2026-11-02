// Responsable: Alfonso - HU-27: iniciar, pausar y detener el temporizador de horas
/**
 * @file temporizador.js
 * @description Temporizador de horas reales (HU-27). El tiempo vive en el servidor, así que sobrevive
 *              a cerrar el navegador y se mantiene al cambiar de pestaña o de página.
 *
 * - Tarjeta flotante con el reloj, "Pausar/Reanudar", "Detener" y "Descartar".
 * - "Detener" abre una confirmación donde se ajustan horas (nunca más de las medidas), fecha y nota.
 * - Solo se permite un temporizador por persona (lo garantiza el servidor).
 * - Es reutilizable: la pantalla "Mis horas" y, más adelante, el detalle de la tarjeta usan `iniciar(tareaId)`.
 *
 * @example
 * const temporizador = inicializarTemporizador({ alCambiar: ({ tipo }) => console.log(tipo) });
 * await temporizador.iniciar(12);
 */

import { api } from '../core/api.js';
import { crear, mensajeDeError, formatearReloj, formatearHoras, validarRegistro } from './horas-comun.js';

const RUTA_API = '/horas/temporizador';
const ESTILOS = ['/css/componentes/horas-comun.css', '/css/componentes/temporizador.css'];
const ETIQUETA_ESTADO = { corriendo: 'En curso', pausado: 'En pausa' };
const ESPERA_CONFIRMAR_DESCARTE_MS = 4000;
/** El reloj se revisa varias veces por segundo para que no se atrase respecto al inicio real. */
const INTERVALO_RELOJ_MS = 250;

/** Carga las hojas de estilo del temporizador una sola vez. */
function asegurarEstilos() {
  for (const ruta of ESTILOS) {
    if (document.querySelector(`link[href="${ruta}"]`)) continue;
    document.head.append(crear('link', { atributos: { rel: 'stylesheet', href: ruta } }));
  }
}

/**
 * Crea el temporizador y lo monta en la página.
 * @param {{contenedor?:HTMLElement, alCambiar?:function({tipo:string, temporizador:Object|null}): void}} [opciones]
 *        `alCambiar` recibe `tipo`: "iniciado", "pausado", "reanudado", "sincronizado", "descartado" o "registrado".
 * @returns {{iniciar:function(number): Promise<Object>, refrescar:function(): Promise<void>,
 *            obtenerActual:function(): (Object|null), destruir:function(): void}}
 */
export function inicializarTemporizador({ contenedor = document.body, alCambiar = () => {} } = {}) {
  asegurarEstilos();

  let actual = null;      // Último temporizador recibido del servidor
  let recibidoEn = 0;     // Date.now() del momento en que se recibió
  let temporizadorDescarte = null;

  /* ---------- Tarjeta flotante ---------- */
  const estado = crear('span', { clase: 'temp__estado' });
  const tarea = crear('p', { clase: 'temp__tarea' });
  const reloj = crear('p', { clase: 'temp__reloj', atributos: { role: 'timer', 'aria-label': 'Tiempo medido' } });
  const error = crear('p', { clase: 'horas-error', atributos: { role: 'alert', hidden: true } });
  const botonPausa = crear('button', {
    clase: 'boton boton--secundario boton--pequeno',
    atributos: { type: 'button' },
    eventos: { click: () => ejecutar(alternarPausa) },
  });
  const botonDetener = crear('button', {
    clase: 'boton boton--primario boton--pequeno',
    texto: 'Detener',
    atributos: { type: 'button' },
    eventos: { click: () => ejecutar(detener) },
  });
  const botonDescartar = crear('button', {
    clase: 'temp__descartar',
    texto: 'Descartar',
    atributos: { type: 'button' },
    eventos: { click: () => ejecutar(descartar) },
  });
  const raiz = crear('section', { clase: 'temp', atributos: { hidden: true, 'aria-label': 'Temporizador de horas' } }, [
    crear('div', { clase: 'temp__cabecera' }, [crear('span', { clase: 'temp__titulo', texto: 'Temporizador' }), estado]),
    tarea,
    reloj,
    crear('div', { clase: 'temp__acciones' }, [botonPausa, botonDetener, botonDescartar]),
    error,
  ]);
  contenedor.append(raiz);

  /* ---------- Estado y pintado ---------- */

  /** @returns {number} Segundos transcurridos ahora (lo recibido + lo que corrió desde entonces). */
  function segundosActuales() {
    if (!actual) return 0;
    const extra = actual.estado === 'corriendo' ? Math.floor((Date.now() - recibidoEn) / 1000) : 0;
    return actual.transcurridoSegundos + extra;
  }

  /** Dibuja la tarjeta según el temporizador actual. */
  function pintar() {
    raiz.hidden = !actual;
    if (!actual) return;
    estado.textContent = ETIQUETA_ESTADO[actual.estado];
    estado.className = `temp__estado temp__estado--${actual.estado}`;
    tarea.textContent = actual.tareaTitulo;
    tarea.title = `${actual.historiaTitulo} › ${actual.tareaTitulo}`;
    botonPausa.textContent = actual.estado === 'corriendo' ? 'Pausar' : 'Reanudar';
    reloj.textContent = formatearReloj(segundosActuales());
  }

  /**
   * Guarda el temporizador recibido del servidor, lo dibuja y avisa a quien lo usa.
   * @param {Object|null} temporizador Temporizador, o `null` si ya no hay.
   * @param {string} tipo Qué ocurrió.
   */
  function fijar(temporizador, tipo) {
    actual = temporizador;
    recibidoEn = Date.now();
    pintar();
    alCambiar({ tipo, temporizador: actual });
  }

  /**
   * Ejecuta una acción mostrando el error en la tarjeta si falla.
   * @param {function(): Promise<void>} accion Acción a ejecutar.
   */
  async function ejecutar(accion) {
    error.hidden = true;
    try {
      await accion();
    } catch (fallo) {
      error.textContent = mensajeDeError(fallo, 'No se pudo completar la acción. Inténtalo de nuevo.');
      error.hidden = false;
    }
  }

  /* ---------- Acciones ---------- */

  /**
   * Consulta al servidor el temporizador vigente (sirve al volver a la pestaña o abrir otra página).
   * @returns {Promise<void>}
   */
  async function refrescar() {
    const respuesta = await api(RUTA_API);
    fijar(respuesta.datos, 'sincronizado');
  }

  /**
   * Inicia el temporizador en una tarea.
   * @param {number} tareaId Tarea a medir.
   * @returns {Promise<Object>} Temporizador iniciado.
   * @throws {Error} Si ya hay uno activo o no se puede registrar en esa tarea (el mensaje viene del servidor).
   */
  async function iniciar(tareaId) {
    const respuesta = await api(`${RUTA_API}/iniciar`, { metodo: 'POST', cuerpo: { tareaId } });
    fijar(respuesta.datos, 'iniciado');
    return respuesta.datos;
  }

  /** Pausa o reanuda según el estado actual. */
  async function alternarPausa() {
    const pausar = actual.estado === 'corriendo';
    const respuesta = await api(`${RUTA_API}/${pausar ? 'pausar' : 'reanudar'}`, { metodo: 'POST' });
    fijar(respuesta.datos, pausar ? 'pausado' : 'reanudado');
  }

  /** Descartar pide una segunda pulsación para evitar perder el tiempo por error. */
  async function descartar() {
    if (temporizadorDescarte === null) {
      botonDescartar.textContent = '¿Seguro? Pulsa otra vez';
      temporizadorDescarte = setTimeout(reiniciarDescarte, ESPERA_CONFIRMAR_DESCARTE_MS);
      return;
    }
    reiniciarDescarte();
    await api(RUTA_API, { metodo: 'DELETE' });
    fijar(null, 'descartado');
  }

  /** Vuelve el botón "Descartar" a su estado normal. */
  function reiniciarDescarte() {
    clearTimeout(temporizadorDescarte);
    temporizadorDescarte = null;
    botonDescartar.textContent = 'Descartar';
  }

  /** Toma el tiempo exacto del servidor y abre la confirmación para registrar las horas. */
  async function detener() {
    await refrescar();
    if (!actual) return;
    const registrado = await confirmarTiempo(actual);
    if (registrado) fijar(null, 'registrado');
  }

  /* ---------- Sincronización ---------- */
  const cadaCuartoDeSegundo = setInterval(() => {
    if (actual?.estado !== 'corriendo') return;
    const texto = formatearReloj(segundosActuales());
    if (reloj.textContent !== texto) reloj.textContent = texto;
  }, INTERVALO_RELOJ_MS);
  const alVolverALaPestana = () => { if (!document.hidden) ejecutar(refrescar); };
  document.addEventListener('visibilitychange', alVolverALaPestana);

  /**
   * Libera el temporizador de la página (no detiene el del servidor).
   * @returns {void}
   */
  function destruir() {
    clearInterval(cadaCuartoDeSegundo);
    reiniciarDescarte();
    document.removeEventListener('visibilitychange', alVolverALaPestana);
    raiz.remove();
  }

  return { iniciar, refrescar, obtenerActual: () => actual, destruir };
}

/**
 * Abre la confirmación del tiempo medido. Permite bajar las horas (nunca subirlas más de lo medido),
 * cambiar la fecha y escribir una nota. Si el servidor rechaza el registro, el temporizador sigue intacto.
 * @param {Object} temporizador Temporizador con el tiempo ya medido por el servidor.
 * @returns {Promise<boolean>} `true` si se registraron las horas.
 */
function confirmarTiempo(temporizador) {
  const muyCorto = temporizador.horasSugeridas <= 0;
  const campoHoras = crear('input', {
    clase: 'horas-entrada',
    atributos: { id: 'temp-horas', type: 'number', min: 0.1, max: 24, step: 0.1, required: true,
      value: muyCorto ? '' : Math.min(temporizador.horasSugeridas, 24), inputmode: 'decimal' },
  });
  const campoFecha = crear('input', {
    clase: 'horas-entrada',
    atributos: { id: 'temp-fecha', type: 'date', max: temporizador.hoy, required: true, value: temporizador.fechaSugerida },
  });
  const campoNota = crear('textarea', {
    clase: 'horas-entrada',
    atributos: { id: 'temp-nota', rows: 2, maxlength: 500, placeholder: 'Opcional: ¿qué hiciste?' },
  });
  const error = crear('p', { clase: 'horas-error', atributos: { role: 'alert', hidden: true } });
  const botonRegistrar = crear('button', {
    clase: 'boton boton--primario',
    texto: 'Registrar horas',
    atributos: { type: 'submit', disabled: muyCorto },
  });
  const dialogo = crear('dialog', { clase: 'horas-dialogo', atributos: { 'aria-labelledby': 'temp-titulo' } }, [
    crear('form', { atributos: { novalidate: true } }, [
      crear('h2', { clase: 'horas-dialogo__titulo', texto: 'Registrar el tiempo medido', atributos: { id: 'temp-titulo' } }),
      crear('p', { clase: 'horas-dialogo__texto', texto: `Tarea: ${temporizador.tareaTitulo}` }),
      crear('p', {
        clase: 'horas-dialogo__texto',
        texto: muyCorto
          ? 'El temporizador lleva menos de 3 minutos. Sigue midiendo o descártalo.'
          : `Tiempo medido: ${formatearReloj(temporizador.transcurridoSegundos)} (${formatearHoras(temporizador.horasSugeridas)} h). Puedes registrar menos, pero no más.`,
      }),
      crear('div', { clase: 'horas-campo' }, [crear('label', { texto: 'Horas', atributos: { for: 'temp-horas' } }), campoHoras]),
      crear('div', { clase: 'horas-campo' }, [crear('label', { texto: 'Fecha', atributos: { for: 'temp-fecha' } }), campoFecha]),
      crear('div', { clase: 'horas-campo' }, [crear('label', { texto: 'Nota', atributos: { for: 'temp-nota' } }), campoNota]),
      error,
      crear('div', { clase: 'horas-acciones' }, [
        crear('button', {
          clase: 'boton boton--secundario',
          texto: 'Seguir midiendo',
          atributos: { type: 'button' },
          eventos: { click: () => dialogo.close('cancelado') },
        }),
        botonRegistrar,
      ]),
    ]),
  ]);

  return new Promise((resolver) => {
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      resolver(dialogo.returnValue === 'registrado');
    });
    dialogo.querySelector('form').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const horas = campoHoras.value === '' ? NaN : Number(campoHoras.value);
      const mensaje = validarRegistro({ horas, fecha: campoFecha.value, hoy: temporizador.hoy });
      if (mensaje) {
        error.textContent = mensaje;
        error.hidden = false;
        return;
      }
      botonRegistrar.disabled = true;
      error.hidden = true;
      try {
        await api(`${RUTA_API}/detener`, { metodo: 'POST', cuerpo: { horas, fecha: campoFecha.value, nota: campoNota.value } });
        dialogo.close('registrado');
      } catch (fallo) {
        error.textContent = mensajeDeError(fallo, 'No se pudo registrar el tiempo. Tus datos se conservaron: inténtalo de nuevo.');
        error.hidden = false;
        botonRegistrar.disabled = false;
      }
    });
    document.body.append(dialogo);
    dialogo.showModal();
    campoHoras.focus();
  });
}