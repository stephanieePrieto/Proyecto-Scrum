/**
 * @file perfil.js
 * @description Lógica de la pantalla de perfil: información del usuario, seguridad (2FA), preferencias y gestión de cuenta.
 * 
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { api } from '../core/api.js';
import { escaparHtml, esZonaHorariaValida, detectarZonaNavegador, conZonaHoraria } from '../core/utils.js';

/** Frase que la persona debe escribir para eliminar su cuenta. Debe coincidir con el servidor. */
const FRASE_ELIMINAR_CUENTA = 'ELIMINAR MI CUENTA';

/** Página donde la persona transfiere su rol de Scrum Master o Product Owner en cada proyecto. */
const RUTA_GESTION_MIEMBROS = '/pages/configuracion-proyecto.html';

// Funciones temporales para que el sistema no colapse al mostrar notificaciones
function mostrarAviso(mensaje, tipo = 'info') {
  alert(mensaje);
}

function mostrarError(mensaje) {
  alert('Error: ' + mensaje);
}

/**
 * Obtener el mensaje que envió el servidor en una respuesta de error de api().
 * api() lanza un Error cuyo mensaje es solo "HTTP <estado>"; el texto útil viene en error.cuerpo.
 *
 * @param {Error & {cuerpo?: Object}} error - Error lanzado por api().
 * @param {string} predeterminado - Mensaje a mostrar si el servidor no envió uno.
 * @returns {string} Mensaje para la persona usuaria.
 */
function mensajeDeError(error, predeterminado) {
  const cuerpo = error?.cuerpo;
  const texto = [cuerpo?.mensaje, cuerpo?.error, cuerpo?.message]
    .find((candidato) => typeof candidato === 'string' && candidato.trim());
  return texto || predeterminado;
}

/**
 * Obtener las iniciales del nombre del usuario para mostrar en el avatar.
 * @param {string} nombre - Nombre completo del usuario.
 * @returns {string} Iniciales (2 letras max).
 */
function obtenerIniciales(nombre) {
  if (!nombre) return '?';
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  if (palabras.length === 1) return palabras[0].charAt(0).toUpperCase();
  return (palabras[0].charAt(0) + palabras[palabras.length - 1].charAt(0)).toUpperCase();
}

/**
 * Mostrar la foto del usuario en el avatar o, si no tiene o no carga, sus iniciales.
 * Solo se aceptan rutas del mismo sitio para no pedir imágenes a otros orígenes.
 *
 * @param {{nombre: string, fotoUrl?: string|null}} usuario - Datos del perfil.
 */
function mostrarAvatar(usuario) {
  const avatar = document.getElementById('perfil-avatar');
  if (!avatar) return;

  const mostrarIniciales = () => { avatar.textContent = obtenerIniciales(usuario.nombre); };
  const ruta = usuario.fotoUrl;

  if (typeof ruta !== 'string' || !/^\/(?!\/)/.test(ruta)) {
    mostrarIniciales();
    return;
  }

  const imagen = document.createElement('img');
  imagen.className = 'perfil-avatar__imagen';
  imagen.alt = `Foto de perfil de ${usuario.nombre}`;
  imagen.addEventListener('error', mostrarIniciales, { once: true });
  imagen.src = ruta;
  avatar.replaceChildren(imagen);
}

/**
 * Mostrar el aviso de error de carga con un botón para volver a intentarlo.
 * @param {string} texto - Mensaje para la persona usuaria.
 */
function mostrarErrorCarga(texto) {
  const aviso = document.getElementById('perfil-aviso');
  if (!aviso) return;

  const mensaje = document.createElement('p');
  mensaje.textContent = texto;

  const reintentar = document.createElement('button');
  reintentar.type = 'button';
  reintentar.className = 'boton boton--secundario boton--pequeno';
  reintentar.textContent = 'Reintentar';
  reintentar.addEventListener('click', cargarInformacionUsuario);

  aviso.classList.add('aviso', 'aviso--peligro');
  aviso.replaceChildren(mensaje, reintentar);
  aviso.hidden = false;
}

/**
 * Cargar información del usuario y actualizar el encabezado del perfil.
 */
async function cargarInformacionUsuario() {
  try {
    const respuesta = await api('/usuarios/yo');
    const usuario = respuesta.usuario ?? respuesta.data?.usuario;

    const nombre = document.getElementById('perfil-nombre');
    const correo = document.getElementById('perfil-correo');
    const campoCorreo = document.getElementById('perfil-campo-correo');
    const aviso = document.getElementById('perfil-aviso');

    mostrarAvatar(usuario);
    usuarioActual = usuario;
    mostrarFotoGuardada();
    mostrarZonaHoraria();
    mostrarPreferenciasNotificacion();
    try {
      mostrarPreferenciasApp();
    } catch (error) {
      console.error('[perfil] No se pudo mostrar la apariencia:', error);
    }
    if (nombre) nombre.textContent = usuario.nombre;
    if (correo) correo.textContent = usuario.correo;
    if (campoCorreo) campoCorreo.value = usuario.correo;
    if (aviso) {
      aviso.hidden = true;
      aviso.replaceChildren();
    }
  } catch (error) {
    console.error('[perfil] Error al cargar información del usuario:', error);
    const nombre = document.getElementById('perfil-nombre');
    const correo = document.getElementById('perfil-correo');
    if (nombre) nombre.textContent = 'Usuario';
    if (correo) correo.textContent = 'No disponible';
    mostrarErrorCarga(mensajeDeError(error, 'No se pudo cargar tu perfil. Revisa tu conexión e inténtalo de nuevo.'));
  }
}

/** Peso máximo permitido para la foto de perfil. */
const LIMITE_FOTO_BYTES = 2 * 1024 * 1024;

/** Tipos de imagen que se aceptan como foto de perfil. */
const TIPOS_FOTO_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];

/** Solo se muestran fotos servidas por este mismo sitio. */
const PATRON_RUTA_INTERNA = /^\/(?!\/)/;

/** Datos del perfil cargados desde el servidor; se usan para las iniciales y la foto guardada. */
let usuarioActual = null;

/** Foto elegida que todavía no se guarda. */
let fotoSeleccionada = null;

/** Evita guardar la foto dos veces mientras una petición sigue en curso. */
let guardandoFoto = false;

/** Zona horaria guardada y reconocida de la cuenta; null si todavía no tiene una o no se reconoce. */
let zonaGuardada = null;

/** Evita guardar la zona horaria dos veces mientras una petición sigue en curso. */
let guardandoZona = false;

/**
 * Reconocer el formato real de una imagen por sus primeros bytes.
 * El tipo que informa el navegador sale de la extensión y no basta para confiar en el archivo.
 *
 * @param {File} archivo - Archivo elegido.
 * @returns {Promise<'jpeg'|'png'|'webp'|null>} El formato, o null si no es JPEG, PNG ni WebP.
 */
async function detectarFormatoFoto(archivo) {
  const bytes = new Uint8Array(await archivo.slice(0, 12).arrayBuffer());
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  const firmaPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (firmaPng.every((valor, i) => bytes[i] === valor)) return 'png';
  const texto = (inicio, fin) => String.fromCharCode(...bytes.slice(inicio, fin));
  if (texto(0, 4) === 'RIFF' && texto(8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Validar la foto elegida antes de mostrarla o enviarla.
 *
 * @param {File} archivo - Archivo elegido.
 * @returns {Promise<string|null>} El motivo del rechazo, o null si la foto es válida.
 */
async function validarFoto(archivo) {
  if (archivo.size === 0) return 'La foto está vacía.';
  if (archivo.size > LIMITE_FOTO_BYTES) {
    const peso = (archivo.size / (1024 * 1024)).toFixed(1);
    return `La foto pesa ${peso} MB y supera el límite de 2 MB.`;
  }
  if (!TIPOS_FOTO_PERMITIDOS.includes(archivo.type) || !(await detectarFormatoFoto(archivo))) {
    return 'Formato no permitido. Usa una imagen JPEG, PNG o WebP.';
  }
  return null;
}

/**
 * Dibujar en el recuadro de la sección la foto indicada o, si no hay, las iniciales.
 *
 * @param {string|null} fuente - Ruta del mismo sitio o data URL de la vista previa.
 */
function pintarVistaFoto(fuente) {
  const vista = document.getElementById('foto-vista');
  if (!vista) return;

  const mostrarIniciales = () => { vista.textContent = obtenerIniciales(usuarioActual?.nombre); };
  if (!fuente) {
    mostrarIniciales();
    return;
  }

  const imagen = document.createElement('img');
  imagen.className = 'perfil-avatar__imagen';
  imagen.alt = 'Vista de la foto de perfil';
  imagen.addEventListener('error', mostrarIniciales, { once: true });
  imagen.src = fuente;
  vista.replaceChildren(imagen);
}

/**
 * Mostrar en el recuadro de la sección la foto que ya está guardada.
 */
function mostrarFotoGuardada() {
  const ruta = usuarioActual?.fotoUrl;
  pintarVistaFoto(typeof ruta === 'string' && PATRON_RUTA_INTERNA.test(ruta) ? ruta : null);
}

/**
 * Mostrar u ocultar un mensaje en el contenedor indicado de un apartado del perfil.
 *
 * @param {string} idContenedor - Id del contenedor del mensaje.
 * @param {'exito'|'peligro'|'advertencia'|'info'|null} tipo - Estilo del aviso; null lo oculta.
 * @param {string} [texto] - Mensaje para la persona usuaria.
 */
function mostrarMensajeEn(idContenedor, tipo, texto = '') {
  const contenedor = document.getElementById(idContenedor);
  if (!contenedor) return;

  if (!tipo) {
    contenedor.hidden = true;
    contenedor.replaceChildren();
    return;
  }

  const mensaje = document.createElement('p');
  mensaje.textContent = texto;
  contenedor.className = `perfil-mensaje aviso aviso--${tipo}`;
  contenedor.setAttribute('role', tipo === 'peligro' ? 'alert' : 'status');
  contenedor.replaceChildren(mensaje);
  contenedor.hidden = false;
}

/**
 * Mostrar un mensaje de éxito o de error en el apartado de la foto.
 *
 * @param {'exito'|'peligro'|null} tipo - Estilo del aviso; null lo oculta.
 * @param {string} [texto] - Mensaje para la persona usuaria.
 */
function mostrarMensajeFoto(tipo, texto = '') {
  mostrarMensajeEn('foto-mensaje', tipo, texto);
}

/**
 * Sincronizar los botones del apartado de la foto con el estado actual.
 */
function actualizarBotonesFoto() {
  const guardar = document.getElementById('btn-guardar-foto');
  const cancelar = document.getElementById('btn-cancelar-foto');
  const elegir = document.getElementById('btn-elegir-foto');
  if (guardar) {
    guardar.disabled = !fotoSeleccionada || guardandoFoto;
    guardar.textContent = guardandoFoto ? 'Guardando...' : 'Guardar foto';
  }
  if (cancelar) {
    cancelar.hidden = !fotoSeleccionada;
    cancelar.disabled = guardandoFoto;
  }
  if (elegir) elegir.disabled = guardandoFoto;
}

/**
 * Descartar la foto elegida y volver a mostrar la guardada.
 */
function descartarFotoSeleccionada() {
  const entrada = document.getElementById('foto-archivo');
  if (entrada) entrada.value = '';
  fotoSeleccionada = null;
  mostrarFotoGuardada();
  actualizarBotonesFoto();
}

/**
 * Validar la foto que eligió la persona y mostrar su vista previa sin guardarla.
 * La vista previa usa una data URL porque la política de seguridad no permite blob:.
 */
async function alElegirFoto() {
  const entrada = document.getElementById('foto-archivo');
  const archivo = entrada?.files?.[0];
  if (!archivo) return;

  mostrarMensajeFoto(null);
  const motivo = await validarFoto(archivo);
  if (motivo) {
    descartarFotoSeleccionada();
    mostrarMensajeFoto('peligro', motivo);
    return;
  }

  const lector = new FileReader();
  lector.addEventListener('load', () => {
    fotoSeleccionada = archivo;
    pintarVistaFoto(String(lector.result));
    actualizarBotonesFoto();
  });
  lector.addEventListener('error', () => {
    descartarFotoSeleccionada();
    mostrarMensajeFoto('peligro', 'No se pudo leer la imagen elegida. Prueba con otra.');
  });
  lector.readAsDataURL(archivo);
}

/**
 * Enviar la foto elegida al servidor. El éxito solo se anuncia cuando el servidor confirma el guardado.
 */
async function guardarFoto() {
  if (!fotoSeleccionada || guardandoFoto) return;

  guardandoFoto = true;
  mostrarMensajeFoto(null);
  actualizarBotonesFoto();

  try {
    const datos = new FormData();
    datos.append('foto', fotoSeleccionada);
    const respuesta = await api('/usuarios/yo/foto', { metodo: 'PUT', cuerpo: datos });
    const nuevaRuta = respuesta?.usuario?.fotoUrl;

    if (typeof nuevaRuta !== 'string' || !PATRON_RUTA_INTERNA.test(nuevaRuta)) {
      throw new Error('El servidor no confirmó el guardado de la foto.');
    }

    usuarioActual = { ...usuarioActual, fotoUrl: nuevaRuta };
    mostrarAvatar(usuarioActual);
    window.dispatchEvent(new CustomEvent('perfil:foto-actualizada', { detail: { fotoUrl: nuevaRuta } }));
    descartarFotoSeleccionada();
    mostrarMensajeFoto('exito', 'Foto de perfil actualizada correctamente.');
  } catch (error) {
    console.error('[perfil] Error al guardar la foto:', error);
    mostrarMensajeFoto('peligro', mensajeDeError(error, 'No se pudo guardar la foto. Inténtalo de nuevo.'));
  } finally {
    guardandoFoto = false;
    actualizarBotonesFoto();
  }
}

/**
 * Conectar los controles del apartado de la foto.
 */
function configurarFoto() {
  const entrada = document.getElementById('foto-archivo');
  document.getElementById('btn-elegir-foto')?.addEventListener('click', () => entrada?.click());
  document.getElementById('btn-guardar-foto')?.addEventListener('click', guardarFoto);
  document.getElementById('btn-cancelar-foto')?.addEventListener('click', () => {
    mostrarMensajeFoto(null);
    descartarFotoSeleccionada();
  });
  entrada?.addEventListener('change', alElegirFoto);
}

/** Zonas que se ofrecen si el navegador no puede listar todas las del estándar IANA. */
const ZONAS_RESPALDO = [
  'UTC', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago',
  'America/Argentina/Buenos_Aires', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Europe/Madrid', 'Europe/London', 'Asia/Tokyo'
];

/**
 * Listar las zonas horarias que se ofrecen en el selector.
 *
 * @returns {string[]}
 */
function listarZonasHorarias() {
  let zonas = ZONAS_RESPALDO;
  try {
    if (typeof Intl.supportedValuesOf === 'function') zonas = Intl.supportedValuesOf('timeZone');
  } catch { /* Se usa la lista de respaldo */ }
  return zonas.includes('UTC') ? zonas : ['UTC', ...zonas];
}

/**
 * Agregar una opción al selector si todavía no existe.
 *
 * @param {HTMLSelectElement} selector - Selector de la zona horaria.
 * @param {string} zona - Identificador IANA.
 */
function asegurarOpcionZona(selector, zona) {
  if ([...selector.options].some((opcion) => opcion.value === zona)) return;
  const opcion = document.createElement('option');
  opcion.value = zona;
  opcion.textContent = zona.replaceAll('_', ' ');
  selector.append(opcion);
}

/**
 * Sincronizar el botón y el selector de la zona horaria con el estado actual.
 * El botón solo se habilita cuando la zona elegida es distinta de la guardada.
 */
function actualizarBotonZona() {
  const selector = document.getElementById('zona-selector');
  const guardar = document.getElementById('btn-guardar-zona');
  if (selector) selector.disabled = guardandoZona || !usuarioActual;
  if (guardar) {
    guardar.disabled = guardandoZona || !selector?.value || selector.value === zonaGuardada;
    guardar.textContent = guardandoZona ? 'Guardando...' : 'Guardar zona horaria';
  }
}

/**
 * Mostrar la zona horaria de la cuenta. Si todavía no tiene una o la guardada no se reconoce,
 * se propone la del navegador y se avisa, pero no se guarda hasta que la persona lo confirme.
 */
function mostrarZonaHoraria() {
  const selector = document.getElementById('zona-selector');
  if (!selector) return;

  const guardada = usuarioActual?.zonaHoraria;
  const navegador = detectarZonaNavegador();

  zonaGuardada = esZonaHorariaValida(guardada) ? guardada : null;
  const mostrada = zonaGuardada ?? navegador;
  asegurarOpcionZona(selector, mostrada);
  selector.value = mostrada;

  if (zonaGuardada) {
    mostrarMensajeEn('zona-aviso', null);
  } else if (typeof guardada === 'string' && guardada.trim()) {
    mostrarMensajeEn('zona-aviso', 'advertencia',
      `La zona horaria guardada (${guardada}) no se reconoce. Se muestra la de tu navegador (${navegador}); guárdala para corregirla.`);
  } else {
    mostrarMensajeEn('zona-aviso', 'info',
      `Todavía no tienes una zona horaria guardada. Se detectó la de tu navegador (${navegador}); guárdala para confirmarla.`);
  }
  actualizarBotonZona();
}

/**
 * Enviar la zona horaria elegida al servidor. El éxito solo se anuncia cuando el servidor confirma el guardado.
 */
async function guardarZonaHoraria() {
  const selector = document.getElementById('zona-selector');
  const elegida = selector?.value;
  if (guardandoZona || !esZonaHorariaValida(elegida)) {
    if (!guardandoZona) mostrarMensajeEn('zona-mensaje', 'peligro', 'Elige una zona horaria válida de la lista.');
    return;
  }

  guardandoZona = true;
  mostrarMensajeEn('zona-mensaje', null);
  actualizarBotonZona();

  try {
    const respuesta = await api('/usuarios/yo/zona-horaria', { metodo: 'PUT', cuerpo: { zonaHoraria: elegida } });
    const confirmada = respuesta?.usuario?.zonaHoraria;

    if (!esZonaHorariaValida(confirmada)) {
      throw new Error('El servidor no confirmó el guardado de la zona horaria.');
    }

    usuarioActual = { ...usuarioActual, zonaHoraria: confirmada };
    mostrarZonaHoraria();
    window.dispatchEvent(new CustomEvent('perfil:zona-actualizada', { detail: { zonaHoraria: confirmada } }));
    mostrarMensajeEn('zona-mensaje', 'exito', 'Zona horaria actualizada correctamente.');
  } catch (error) {
    console.error('[perfil] Error al guardar la zona horaria:', error);
    mostrarMensajeEn('zona-mensaje', 'peligro', mensajeDeError(error, 'No se pudo guardar la zona horaria. Inténtalo de nuevo.'));
  } finally {
    guardandoZona = false;
    actualizarBotonZona();
  }
}

/**
 * Conectar los controles del apartado de la zona horaria y llenar el selector.
 */
function configurarZona() {
  const selector = document.getElementById('zona-selector');
  if (!selector) return;

  selector.replaceChildren();
  listarZonasHorarias().forEach((zona) => asegurarOpcionZona(selector, zona));
  selector.addEventListener('change', () => {
    mostrarMensajeEn('zona-mensaje', null);
    actualizarBotonZona();
  });
  document.getElementById('btn-guardar-zona')?.addEventListener('click', guardarZonaHoraria);
}

/** Canales y tipos de notificación que se configuran; el id de cada control sale de canal y tipo. */
const CAMPOS_NOTIFICACION = [
  { canal: 'interna', tipo: 'asignacion' },
  { canal: 'interna', tipo: 'mencion' },
  { canal: 'interna', tipo: 'desviacion' },
  { canal: 'interna', tipo: 'impedimento' },
  { canal: 'interna', tipo: 'miembro_salida' },
  { canal: 'correo', tipo: 'asignacion' },
  { canal: 'correo', tipo: 'mencion' },
  { canal: 'correo', tipo: 'desviacion' },
  { canal: 'correo', tipo: 'impedimento' },
  { canal: 'correo', tipo: 'miembro_salida' },
];

/** Valor que se muestra si la cuenta todavía no tiene preferencias guardadas (mismo que el servidor). */
const NOTIFICACION_POR_DEFECTO = { interna: true, correo: false };

/** Indica si ya se está guardando la configuración de notificaciones. */
let guardandoNotificaciones = false;

/**
 * Id del control de un canal y tipo de notificación.
 * @param {{canal: string, tipo: string}} campo
 * @returns {string}
 */
const idCampoNotificacion = ({ canal, tipo }) => `notif-${canal}-${tipo}`;

/**
 * Leer las preferencias de notificación que la persona tiene guardadas en el servidor.
 * @returns {Object<string, Object<string, boolean>>} Matriz canal → tipo → activo.
 */
function preferenciasGuardadas() {
  const guardadas = usuarioActual?.preferenciasNotif;
  const salida = { interna: {}, correo: {} };
  for (const { canal, tipo } of CAMPOS_NOTIFICACION) {
    salida[canal][tipo] = guardadas?.[canal]?.[tipo] ?? NOTIFICACION_POR_DEFECTO[canal];
  }
  return salida;
}

/**
 * Leer las preferencias de notificación tal como están marcadas en la pantalla.
 * @returns {Object<string, Object<string, boolean>>} Matriz canal → tipo → activo.
 */
function preferenciasDesdeFormulario() {
  const salida = { interna: {}, correo: {} };
  for (const campo of CAMPOS_NOTIFICACION) {
    salida[campo.canal][campo.tipo] = document.getElementById(idCampoNotificacion(campo))?.checked === true;
  }
  return salida;
}

/**
 * Mostrar en la pantalla las preferencias guardadas y limpiar el aviso anterior.
 */
function mostrarPreferenciasNotificacion() {
  const guardadas = preferenciasGuardadas();
  for (const campo of CAMPOS_NOTIFICACION) {
    const control = document.getElementById(idCampoNotificacion(campo));
    if (control) control.checked = guardadas[campo.canal][campo.tipo];
  }
  mostrarMensajeEn('notif-mensaje', null);
  actualizarBotonNotificaciones();
}

/**
 * Indicar si la pantalla tiene cambios que aún no se guardaron.
 * @returns {boolean}
 */
function hayCambiosNotificacion() {
  const guardadas = preferenciasGuardadas();
  const actuales = preferenciasDesdeFormulario();
  return CAMPOS_NOTIFICACION.some(({ canal, tipo }) => guardadas[canal][tipo] !== actuales[canal][tipo]);
}

/**
 * Sincronizar el botón de notificaciones. No se habilita si la configuración no se cargó, para no
 * guardar valores que la persona no eligió.
 */
function actualizarBotonNotificaciones() {
  const boton = document.getElementById('btn-guardar-notificaciones');
  if (!boton) return;
  const cargada = Boolean(usuarioActual?.preferenciasNotif);
  boton.disabled = guardandoNotificaciones || !cargada || !hayCambiosNotificacion();
  boton.textContent = guardandoNotificaciones ? 'Guardando...' : 'Guardar notificaciones';
}

/**
 * Enviar las preferencias de notificación al servidor. El éxito solo se anuncia cuando el servidor
 * confirma el guardado.
 */
async function guardarPreferenciasNotificacion() {
  if (guardandoNotificaciones || !usuarioActual?.preferenciasNotif || !hayCambiosNotificacion()) return;

  guardandoNotificaciones = true;
  mostrarMensajeEn('notif-mensaje', null);
  actualizarBotonNotificaciones();

  try {
    const respuesta = await api('/usuarios/yo/preferencias-notificacion', {
      metodo: 'PUT',
      cuerpo: preferenciasDesdeFormulario(),
    });
    const confirmadas = respuesta?.usuario?.preferenciasNotif;
    if (!confirmadas || typeof confirmadas !== 'object') {
      throw new Error('El servidor no confirmó el guardado de las notificaciones.');
    }

    usuarioActual = { ...usuarioActual, preferenciasNotif: confirmadas };
    mostrarPreferenciasNotificacion();
    mostrarMensajeEn('notif-mensaje', 'exito', 'Preferencias de notificación actualizadas correctamente.');
  } catch (error) {
    console.error('[perfil] Error al guardar las notificaciones:', error);
    mostrarMensajeEn('notif-mensaje', 'peligro', mensajeDeError(error, 'No se pudieron guardar las preferencias. Inténtalo de nuevo.'));
  } finally {
    guardandoNotificaciones = false;
    actualizarBotonNotificaciones();
  }
}

/**
 * Conectar los controles del apartado de notificaciones.
 */
function configurarNotificaciones() {
  for (const campo of CAMPOS_NOTIFICACION) {
    document.getElementById(idCampoNotificacion(campo))?.addEventListener('change', () => {
      mostrarMensajeEn('notif-mensaje', null);
      actualizarBotonNotificaciones();
    });
  }
  document.getElementById('btn-guardar-notificaciones')?.addEventListener('click', guardarPreferenciasNotificacion);
}

/** Controles del tema y de la accesibilidad; cada uno se guarda por separado. */
const CONTROLES_ACCESIBILIDAD = {
  'acc-texto-grande': 'textoGrande',
  'acc-alto-contraste': 'altoContraste',
  'acc-reducir-animaciones': 'reducirAnimaciones',
};

/** Indica si ya se está guardando alguno de los dos bloques de apariencia. */
let guardandoPreferenciasApp = false;

/**
 * Preferencias de apariencia que la persona tiene guardadas en el servidor (completadas con los valores por defecto).
 * @returns {{tema: string, textoGrande: boolean, altoContraste: boolean, reducirAnimaciones: boolean}}
 */
function preferenciasAppGuardadas() {
  return normalizarApariencia(usuarioActual?.preferenciasApp);
}

/**
 * Normaliza las preferencias de apariencia. Si apariencia.js no cargó, usa los mismos valores por defecto.
 * @param {*} valor
 * @returns {{tema: string, textoGrande: boolean, altoContraste: boolean, reducirAnimaciones: boolean}}
 */
function normalizarApariencia(valor) {
  if (window.ScrumApariencia) return window.ScrumApariencia.normalizar(valor);
  const datos = valor !== null && typeof valor === 'object' ? valor : {};
  return {
    tema: ['claro', 'oscuro'].includes(datos.tema) ? datos.tema : 'claro',
    textoGrande: datos.textoGrande === true,
    altoContraste: datos.altoContraste === true,
    reducirAnimaciones: datos.reducirAnimaciones === true,
  };
}

/**
 * Tema marcado en la pantalla.
 * @returns {string}
 */
function temaElegido() {
  return document.querySelector('input[name="tema-app"]:checked')?.value ?? 'claro';
}

/**
 * Ajustes de accesibilidad marcados en la pantalla.
 * @returns {{textoGrande: boolean, altoContraste: boolean, reducirAnimaciones: boolean}}
 */
function accesibilidadElegida() {
  const salida = {};
  for (const [id, clave] of Object.entries(CONTROLES_ACCESIBILIDAD)) {
    salida[clave] = document.getElementById(id)?.checked === true;
  }
  return salida;
}

/**
 * Mostrar en la pantalla lo que está guardado y limpiar los avisos anteriores.
 */
function mostrarPreferenciasApp() {
  const guardadas = preferenciasAppGuardadas();
  for (const radio of document.querySelectorAll('input[name="tema-app"]')) {
    radio.checked = radio.value === guardadas.tema;
  }
  for (const [id, clave] of Object.entries(CONTROLES_ACCESIBILIDAD)) {
    const control = document.getElementById(id);
    if (control) control.checked = guardadas[clave];
  }
  mostrarMensajeEn('apariencia-mensaje', null);
  mostrarMensajeEn('accesibilidad-mensaje', null);
  actualizarBotonesApp();
}

/**
 * Sincronizar los botones de cada bloque. Ninguno se habilita sin datos cargados ni sin cambios.
 */
function actualizarBotonesApp() {
  const cargada = Boolean(usuarioActual?.preferenciasApp);
  const guardadas = preferenciasAppGuardadas();
  const cambiosApariencia = temaElegido() !== guardadas.tema;
  const cambiosAccesibilidad = Object.entries(accesibilidadElegida()).some(([clave, valor]) => guardadas[clave] !== valor);

  const botonApariencia = document.getElementById('btn-guardar-apariencia');
  if (botonApariencia) botonApariencia.disabled = guardandoPreferenciasApp || !cargada || !cambiosApariencia;

  const botonAccesibilidad = document.getElementById('btn-guardar-accesibilidad');
  if (botonAccesibilidad) botonAccesibilidad.disabled = guardandoPreferenciasApp || !cargada || !cambiosAccesibilidad;
}

/**
 * Guardar un bloque (apariencia o accesibilidad). El otro bloque se envía con sus valores guardados,
 * así que guardar uno no cambia el otro. El éxito solo se anuncia cuando el servidor confirma.
 * @param {'apariencia'|'accesibilidad'} bloque
 */
async function guardarPreferenciasApp(bloque) {
  const esApariencia = bloque === 'apariencia';
  const mensajeId = esApariencia ? 'apariencia-mensaje' : 'accesibilidad-mensaje';
  if (guardandoPreferenciasApp || !usuarioActual?.preferenciasApp) return;

  const guardadas = preferenciasAppGuardadas();
  const hayCambios = esApariencia
    ? temaElegido() !== guardadas.tema
    : Object.entries(accesibilidadElegida()).some(([clave, valor]) => guardadas[clave] !== valor);
  if (!hayCambios) return;

  guardandoPreferenciasApp = true;
  mostrarMensajeEn(mensajeId, null);
  actualizarBotonesApp();

  try {
    const enviadas = esApariencia
      ? { ...guardadas, tema: temaElegido() }
      : { ...guardadas, ...accesibilidadElegida() };
    const respuesta = await api('/usuarios/yo/preferencias-aplicacion', { metodo: 'PUT', cuerpo: enviadas });
    const confirmadas = respuesta?.usuario?.preferenciasApp;
    if (!confirmadas || typeof confirmadas !== 'object') {
      throw new Error('El servidor no confirmó el guardado de la apariencia.');
    }

    usuarioActual = { ...usuarioActual, preferenciasApp: confirmadas };
    window.ScrumApariencia?.guardarLocal(confirmadas);
    window.ScrumApariencia?.aplicar(confirmadas);
    mostrarPreferenciasApp();
    mostrarMensajeEn(mensajeId, 'exito', esApariencia
      ? 'Apariencia actualizada correctamente.'
      : 'Accesibilidad actualizada correctamente.');
  } catch (error) {
    console.error('[perfil] Error al guardar la apariencia:', error);
    mostrarMensajeEn(mensajeId, 'peligro', mensajeDeError(error, 'No se pudieron guardar los cambios. Inténtalo de nuevo.'));
  } finally {
    guardandoPreferenciasApp = false;
    actualizarBotonesApp();
  }
}

/**
 * Conectar los controles de apariencia y accesibilidad.
 */
function configurarPreferenciasApp() {
  const controles = [
    ...document.querySelectorAll('input[name="tema-app"]'),
    ...Object.keys(CONTROLES_ACCESIBILIDAD).map((id) => document.getElementById(id)),
  ];
  for (const control of controles) {
    control?.addEventListener('change', () => {
      mostrarMensajeEn('apariencia-mensaje', null);
      mostrarMensajeEn('accesibilidad-mensaje', null);
      actualizarBotonesApp();
    });
  }
  document.getElementById('btn-guardar-apariencia')?.addEventListener('click', () => guardarPreferenciasApp('apariencia'));
  document.getElementById('btn-guardar-accesibilidad')?.addEventListener('click', () => guardarPreferenciasApp('accesibilidad'));
}

/**
 * Cambiar la seccion activa en el perfil.
 * @param {string} seccion - Identificador de la seccion a mostrar.
 */
function mostrarSeccion(seccion) {
  document.querySelectorAll('.perfil-seccion').forEach(s => s.classList.remove('activa'));
  document.querySelectorAll('.perfil-enlace').forEach(enlace => enlace.classList.remove('activo'));

  const seccionElemento = document.getElementById(`seccion-${seccion}`);
  if (seccionElemento) seccionElemento.classList.add('activa');

  const enlaceActivo = document.querySelector(`[data-seccion="${seccion}"]`);
  if (enlaceActivo) enlaceActivo.classList.add('activo');

  if (seccion === 'seguridad') cargarSeccionSeguridad();
}

/**
 * Configurar la navegacion entre secciones del perfil.
 */
function configurarNavegacion() {
  document.querySelectorAll('.perfil-enlace').forEach(enlace => {
    enlace.addEventListener('click', (e) => {
      e.preventDefault();
      const seccion = enlace.getAttribute('data-seccion');
      mostrarSeccion(seccion);
      history.pushState(null, '', `#${seccion}`);
    });
  });

  window.addEventListener('popstate', () => {
    const hash = window.location.hash.substring(1);
    mostrarSeccion(hash || 'perfil');
  });

  const hash = window.location.hash.substring(1);
  if (hash) mostrarSeccion(hash);
}

/**
 * Estado actual de 2FA del usuario.
 */
let estado2FA = {
  habilitado: false,
  metodos: { totp: { activado: false }, correo: { activado: false } },
  codigosRespaldo: { generados: false, total: 0, restantes: 0 },
  dispositivosConfianza: 0,
  recuperacion: null
};

/**
 * Cargar la seccion de Seguridad con la configuracion de 2FA.
 */
async function cargarSeccionSeguridad() {
  const contenedor = document.getElementById('contenido-seguridad');
  if (!contenedor) return;

  try {
    const respuesta = await api('/usuarios/2fa/estado');
    estado2FA = respuesta;
    const codigosRestantes = Number(estado2FA.codigosRespaldo?.restantes) || 0;

    contenedor.innerHTML = `
      <div class="2fa-contenedor">
        <!-- Estado general de 2FA -->
        <div class="tarjeta tarjeta--seguridad" style="margin-bottom: 1.5rem;">
          <div class="tarjeta__cuerpo">
            <h3 style="margin: 0 0 0.5rem 0;">Autenticación en Dos Pasos</h3>
            <p style="color: var(--color-texto-secundario); margin: 0 0 1rem 0; font-size: 0.9rem;">
              ${estado2FA.habilitado
        ? 'El 2FA está activado en tu cuenta. Se requerirá un código adicional al iniciar sesión.'
        : 'El 2FA no está activado en tu cuenta. Actívalo para mayor seguridad.'}
            </p>
            
            <div class="2fa-estado" style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
              <span style="font-weight: 500;">Estado: ${estado2FA.habilitado ? 'Activado' : 'Desactivado'}</span>
              <label class="interruptor">
                <input type="checkbox" id="toggle-2fa" ${estado2FA.habilitado ? 'checked' : ''}>
                <span class="interruptor-deslizante"></span>
              </label>
            </div>

            ${estado2FA.habilitado ? `
              <div class="aviso aviso--exito" style="margin-top: 1rem;">
                <p style="margin: 0;"><strong>2FA Activado:</strong> Tu cuenta está protegida con autenticación en dos pasos.</p>
              </div>
            ` : `
              <div class="aviso aviso--advertencia" style="margin-top: 1rem;">
                <p style="margin: 0;">Para activar el 2FA, debes configurar al menos un método de autenticación.</p>
              </div>
            `}

            ${estado2FA.recuperacion ? `
              <div class="aviso aviso--peligro" style="margin-top: 1.5rem; margin-bottom: 1.5rem; border: 2px solid #dc3545;">
                  <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                      <div>
                          <h4 style="margin: 0 0 0.5rem 0; color: #721c24;">¡Recuperación de cuenta en proceso!</h4>
                          <p style="margin: 0; font-size: 0.9rem; color: #721c24;">Se solicitó recuperar el acceso a esta cuenta el ${new Date(estado2FA.recuperacion.solicitado_en).toLocaleString(undefined, conZonaHoraria())}. Si no fuiste tú, cancela la solicitud inmediatamente.</p>
                      </div>
                      <button class="boton boton--peligro boton--pequeno" id="btn-cancelar-recuperacion-perfil">Cancelar solicitud</button>
                  </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Metodos de autenticacion -->
        <div class="2fa-metodos" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <!-- Google Authenticator -->
          <div class="tarjeta">
            <div class="tarjeta__cabecera" style="display: flex; align-items: center; gap: 0.5rem;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="2" width="20" height="20" rx="2" ry="2"/>
                <path d="M12 7v10"/><path d="M7 12h10"/>
              </svg>
              <h3 style="margin: 0;">Google Authenticator</h3>
            </div>
            <div class="tarjeta__cuerpo">
              <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-texto-secundario);">
                Genera códigos de 6 dígitos desde tu aplicación móvil.
              </p>
              
              ${estado2FA.metodos.totp.activado ? `
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
                  <span class="insignia insignia--exito">Activado</span>
                  <span style="font-size: 0.8rem; color: var(--color-texto-secundario);">
                    ${estado2FA.metodos.totp.activadoEn ? new Date(estado2FA.metodos.totp.activadoEn).toLocaleDateString(undefined, conZonaHoraria()) : ''}
                  </span>
                </div>
                <button class="boton boton--secundario boton--pequeno" id="btn-desactivar-totp" style="margin-right: 0.5rem;">Desactivar</button>
              ` : `<button class="boton boton--primario boton--pequeno" id="btn-activar-totp">Configurar</button>`}
            </div>
          </div>

          <!-- Correo electronico -->
          <div class="tarjeta">
            <div class="tarjeta__cabecera" style="display: flex; align-items: center; gap: 0.5rem;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <path d="M22 6l-10 7L2 6"/>
              </svg>
              <h3 style="margin: 0;">Código por Correo</h3>
            </div>
            <div class="tarjeta__cuerpo">
              <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-texto-secundario);">
                Recibe un código de 6 dígitos en tu correo electrónico.
              </p>
              
              ${estado2FA.metodos.correo.activado ? `
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
                  <span class="insignia insignia--exito">Activado</span>
                  <span style="font-size: 0.8rem; color: var(--color-texto-secundario);">
                    ${estado2FA.metodos.correo.activadoEn ? new Date(estado2FA.metodos.correo.activadoEn).toLocaleDateString(undefined, conZonaHoraria()) : ''}
                  </span>
                </div>
                <button class="boton boton--secundario boton--pequeno" id="btn-desactivar-correo">Desactivar</button>
              ` : `<button class="boton boton--primario boton--pequeno" id="btn-activar-correo">Activar</button>`}
            </div>
          </div>
        </div>

        <!-- Códigos de respaldo -->
        <div class="tarjeta" style="margin-bottom: 1.5rem;">
          <div class="tarjeta__cabecera"><h3 style="margin: 0;">Códigos de Respaldo</h3></div>
          <div class="tarjeta__cuerpo">
            <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-texto-secundario);">
              Úsalos si pierdes acceso a tus métodos de autenticación. Cada código solo puede usarse una vez.
            </p>
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
              <span>Códigos disponibles: ${codigosRestantes}</span>
              ${estado2FA.codigosRespaldo?.generados && codigosRestantes === 0 ? `
                <span style="font-size: 0.85rem; color: var(--color-texto-secundario);">Ya usaste todos tus códigos. Genera nuevos.</span>
              ` : ''}
            </div>
            
            ${codigosRestantes > 0 ? `
              <button class="boton boton--peligro boton--pequeno" id="btn-regenerar-respaldo">Regenerar</button>
            ` : `
              <button class="boton boton--primario boton--pequeno" id="btn-generar-respaldo">Generar Códigos</button>
            `}
          </div>
        </div>

        <!-- Dispositivos de confianza -->
        <div class="tarjeta">
          <div class="tarjeta__cabecera"><h3 style="margin: 0;">Dispositivos de Confianza</h3></div>
          <div class="tarjeta__cuerpo">
            <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-texto-secundario);">
              Dispositivos donde puedes omitir el 2FA durante 14 días.
            </p>
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
              <span>Dispositivos registrados: ${estado2FA.dispositivosConfianza}</span>
            </div>
            <button class="boton boton--primario boton--pequeno" id="btn-registrar-dispositivo">Registrar este dispositivo</button>
            ${estado2FA.dispositivosConfianza > 0 ? `
              <button class="boton boton--secundario boton--pequeno" id="btn-ver-dispositivos" style="margin-left: 0.5rem;">Ver dispositivos</button>
              <button class="boton boton--peligro boton--pequeno" id="btn-revocar-todos-dispositivos" style="margin-left: 0.5rem;">Revocar todos</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    configurarEventosSeguridad();
  } catch (error) {
    console.error('[perfil] Error al cargar seccion de seguridad:', error);
    contenedor.innerHTML = `
      <div class="aviso aviso--error">
        <p>Error al cargar la configuración de seguridad. Inténtalo de nuevo más tarde.</p>
      </div>
    `;
  }
}

/**
 * Configurar eventos de los botones de la seccion de seguridad.
 */
function configurarEventosSeguridad() {
  const toggle2FA = document.getElementById('toggle-2fa');
  if (toggle2FA) {
    toggle2FA.addEventListener('change', async (e) => {
      const habilitar = e.target.checked;
      if (habilitar) {
        if (!estado2FA.metodos.totp.activado && !estado2FA.metodos.correo.activado) {
          e.target.checked = false;
          mostrarError('Para activar el 2FA, debes configurar al menos un método de autenticación.');
          return;
        }
        const password = await solicitarPassword('Ingresa tu contraseña para activar el 2FA.');
        if (!password) { e.target.checked = false; return; }
        try {
          await api('/usuarios/2fa/habilitar', { metodo: 'POST', cuerpo: { password } });
          mostrarAviso('2FA activado correctamente.', 'exito');
          estado2FA.habilitado = true;
        } catch (error) {
          e.target.checked = false;
          mostrarError(mensajeDeError(error, 'Error al activar el 2FA.'));
        }
      } else {
        const password = prompt('Ingresa tu contraseña para desactivar el 2FA:');
        if (!password) { e.target.checked = true; return; }
        try {
          await api('/usuarios/2fa/deshabilitar', { metodo: 'POST', cuerpo: { password } });
          mostrarAviso('2FA desactivado correctamente.', 'exito');
          estado2FA.habilitado = false;
        } catch (error) {
          e.target.checked = true;
          mostrarError(mensajeDeError(error, 'Error al desactivar el 2FA.'));
        }
      }
    });
  }

  // Configurar TOTP

  const btnActivarTotp = document.getElementById('btn-activar-totp');
  if (btnActivarTotp) btnActivarTotp.addEventListener('click', iniciarConfiguracionTotp);

  // Desactivar TOTP
  const btnDesactivarTotp = document.getElementById('btn-desactivar-totp');
  if (btnDesactivarTotp) {
    btnDesactivarTotp.addEventListener('click', async () => {
      const confirmar = confirm('¿Estás seguro de que quieres desactivar Google Authenticator?');
      if (!confirmar) return;
      const password = prompt('Ingresa tu contraseña para confirmar:');
      if (!password) return;
      try {
        await api('/usuarios/2fa/totp/desactivar', { metodo: 'POST', cuerpo: { password } });
        mostrarAviso('Google Authenticator desactivado correctamente.', 'exito');
        estado2FA.metodos.totp.activado = false;
        cargarSeccionSeguridad();
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al desactivar Google Authenticator.'));
      }
    });
  }

  // Activar/Desactivar correo
  const btnActivarCorreo = document.getElementById('btn-activar-correo');
  if (btnActivarCorreo) {
    btnActivarCorreo.addEventListener('click', async () => {
      const password = await solicitarPassword('Ingresa tu contraseña para activar el código por correo.');
      if (!password) return;
      try {
        const solicitud = await api('/usuarios/2fa/correo/activar', { metodo: 'POST', cuerpo: { password } });
        if (!solicitud.pendienteVerificacion) { cargarSeccionSeguridad(); return; }
        const resultado = await pedirCodigoCorreo((codigo) => api('/usuarios/2fa/correo/confirmar', { metodo: 'POST', cuerpo: { codigo } }));
        if (!resultado) { mostrarAviso('Activación cancelada. El código por correo no quedó activado.', 'info'); return; }
        estado2FA.metodos.correo.activado = true;
        estado2FA.metodos.correo.activadoEn = new Date().toISOString();
        cargarSeccionSeguridad();
        avisarActivacionDeMetodo(resultado, 'Código por correo activado correctamente. Recibirás un código en tu próxima autenticación.');
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al activar código por correo.'));
      }
    });
  }

  const btnDesactivarCorreo = document.getElementById('btn-desactivar-correo');
  if (btnDesactivarCorreo) {
    btnDesactivarCorreo.addEventListener('click', async () => {
      const confirmar = confirm('¿Estás seguro de que quieres desactivar el código por correo?');
      if (!confirmar) return;
      const password = prompt('Ingresa tu contraseña para confirmar:');
      if (!password) return;
      try {
        await api('/usuarios/2fa/correo/desactivar', { metodo: 'POST', cuerpo: { password } });
        mostrarAviso('Código por correo desactivado correctamente.', 'exito');
        estado2FA.metodos.correo.activado = false;
        cargarSeccionSeguridad();
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al desactivar código por correo.'));
      }
    });
  }

  const btnGenerarRespaldo = document.getElementById('btn-generar-respaldo');
  if (btnGenerarRespaldo) btnGenerarRespaldo.addEventListener('click', generarCodigosRespaldo);

  const btnRegenerarRespaldo = document.getElementById('btn-regenerar-respaldo');
  if (btnRegenerarRespaldo) {
    btnRegenerarRespaldo.addEventListener('click', () => {
      const confirmar = confirm('¿Estás seguro de que quieres regenerar los códigos de respaldo? Los códigos actuales dejarán de funcionar.');
      if (confirmar) generarCodigosRespaldo();
    });
  }

  const btnRegistrarDispositivo = document.getElementById('btn-registrar-dispositivo');
  if (btnRegistrarDispositivo) btnRegistrarDispositivo.addEventListener('click', registrarDispositivoConfianza);

  const btnVerDispositivos = document.getElementById('btn-ver-dispositivos');
  if (btnVerDispositivos) btnVerDispositivos.addEventListener('click', listarDispositivosConfianza);

  const btnRevocarTodosDispositivos = document.getElementById('btn-revocar-todos-dispositivos');
  if (btnRevocarTodosDispositivos) {
    btnRevocarTodosDispositivos.addEventListener('click', async () => {
      const confirmar = confirm('¿Estás seguro de que quieres revocar TODOS los dispositivos de confianza?');
      if (!confirmar) return;
      const password = prompt('Ingresa tu contraseña para confirmar:');
      if (!password) return;
      try {
        await api('/usuarios/2fa/dispositivos/revocar-todos', { metodo: 'POST', cuerpo: { password } });
        mostrarAviso('Todos los dispositivos de confianza han sido revocados.', 'exito');
        estado2FA.dispositivosConfianza = 0;
        cargarSeccionSeguridad();
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al revocar dispositivos.'));
      }
    });
  }

  const btnCancelarRecuperacion = document.getElementById('btn-cancelar-recuperacion-perfil');
  if (btnCancelarRecuperacion) {
    btnCancelarRecuperacion.addEventListener('click', async () => {
      const confirmar = confirm('¿Estás seguro de que quieres cancelar la recuperación de cuenta en curso?');
      if (!confirmar) return;
      try {
        await api('/usuarios/2fa/recuperar/cancelar', { metodo: 'POST', cuerpo: {} });
        mostrarAviso('Recuperación cancelada correctamente. Tu cuenta está segura.', 'exito');
        cargarSeccionSeguridad();
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al cancelar la recuperación.'));
      }
    });
  }
}

function solicitarPassword(mensaje) {
  return new Promise((resolver) => {
    const overlay = document.getElementById('modal-password-overlay');
    const texto = document.getElementById('modal-password-mensaje');
    const input = document.getElementById('modal-password-input');
    const btnAceptar = document.getElementById('btn-aceptar-password');
    const btnCancelar = document.getElementById('btn-cancelar-password');

    if (!overlay || !texto || !input || !btnAceptar || !btnCancelar) return resolver(null);

    const cerrar = (valor) => {
      overlay.classList.add('modal--hidden');
      document.body.style.overflow = '';
      input.value = '';
      resolver(valor);
    };

    btnAceptar.onclick = () => { if (!input.value) input.focus(); else cerrar(input.value); };
    btnCancelar.onclick = () => cerrar(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btnAceptar.onclick(); } };

    texto.textContent = mensaje;
    input.value = '';
    overlay.classList.remove('modal--hidden');
    document.body.style.overflow = 'hidden';
    input.focus();
  });
}

function pedirCodigoCorreo(verificar) {
  return new Promise((resolver) => {
    const overlay = document.getElementById('modal-correo-overlay');
    const input = document.getElementById('codigo-correo-verificar');
    const error = document.getElementById('modal-correo-error');
    const btnConfirmar = document.getElementById('btn-confirmar-correo');
    const btnCancelar = document.getElementById('btn-cancelar-correo');

    if (!overlay || !input || !error || !btnConfirmar || !btnCancelar) return resolver(null);

    const cerrar = (valor) => {
      overlay.classList.add('modal--hidden');
      document.body.style.overflow = '';
      input.value = '';
      error.textContent = '';
      resolver(valor);
    };

    const confirmar = async () => {
      const codigo = input.value.trim();
      if (!/^\d{6}$/.test(codigo)) { error.textContent = 'El código debe tener 6 dígitos.'; return; }
      btnConfirmar.disabled = true;
      error.textContent = '';
      try {
        cerrar(await verificar(codigo));
      } catch (fallo) {
        error.textContent = mensajeDeError(fallo, 'Código inválido. Inténtalo de nuevo.');
        input.value = '';
        input.focus();
      } finally {
        btnConfirmar.disabled = false;
      }
    };

    btnConfirmar.onclick = confirmar;
    btnCancelar.onclick = () => cerrar(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } };

    input.value = '';
    error.textContent = '';
    overlay.classList.remove('modal--hidden');
    document.body.style.overflow = 'hidden';
    input.focus();
  });
}

function mostrarModalCodigosRespaldo(codigos) {
  const overlay = document.getElementById('modal-respaldo-overlay');
  const contenedor = document.getElementById('modal-respaldo-codigos');
  if (!overlay || !contenedor) return;

  contenedor.innerHTML = codigos.map((codigo, index) => `
    <div class="tarjeta" style="padding: 0.75rem; text-align: center; font-family: monospace; font-size: 0.875rem;">
      <code style="font-size: 1.1rem; letter-spacing: 0.2rem;">${escaparHtml(codigo)}</code>
      <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--color-texto-secundario);">#${index + 1}</div>
    </div>
  `).join('');

  overlay.classList.remove('modal--hidden');
  document.body.style.overflow = 'hidden';
}

function configurarModalRespaldo() {
  const overlay = document.getElementById('modal-respaldo-overlay');
  if (!overlay) return;

  const obtenerCodigos = () => Array.from(document.querySelectorAll('#modal-respaldo-codigos code')).map(e => e.textContent);

  const btnCopiar = document.getElementById('btn-copiar-respaldo');
  if (btnCopiar) {
    btnCopiar.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(obtenerCodigos().join('\n'));
        mostrarAviso('Códigos copiados al portapapeles.', 'exito');
      } catch (error) {
        mostrarError('No se pudieron copiar los códigos. Descárgalos o cópialos a mano.');
      }
    });
  }

  const btnDescargar = document.getElementById('btn-descargar-respaldo');
  if (btnDescargar) {
    btnDescargar.addEventListener('click', () => {
      const lineas = obtenerCodigos().map((codigo, index) => `${index + 1}. ${codigo}`);
      const contenido = ['Códigos de respaldo de ScrumFlow', 'Cada código solo puede usarse una vez.', '', ...lineas, ''].join('\r\n');
      const url = URL.createObjectURL(new Blob([contenido], { type: 'text/plain;charset=utf-8' }));
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'codigos-respaldo-scrumflow.txt';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    });
  }

  const btnCerrar = document.getElementById('btn-cerrar-respaldo');
  if (btnCerrar) {
    btnCerrar.addEventListener('click', () => {
      overlay.classList.add('modal--hidden');
      document.body.style.overflow = '';
    });
  }
}

function avisarActivacionDeMetodo(resultado, mensajeMetodo) {
  if (!resultado?.activadoAutomaticamente) {
    mostrarAviso(mensajeMetodo, 'exito');
    return;
  }
  estado2FA.habilitado = true;
  mostrarAviso(`${mensajeMetodo} El 2FA quedó activado en tu cuenta.`, 'exito');
  if (Array.isArray(resultado.codigos) && resultado.codigos.length > 0) {
    mostrarModalCodigosRespaldo(resultado.codigos);
  } else {
    mostrarAviso('No se pudieron generar tus códigos de respaldo. Genéralos desde la sección de seguridad antes de cerrar sesión.', 'advertencia');
  }
}

async function iniciarConfiguracionTotp() {
  const password = await solicitarPassword('Ingresa tu contraseña para configurar Google Authenticator.');
  if (!password) return;

  try {
    const respuesta = await api('/usuarios/2fa/totp/iniciar', { metodo: 'POST', cuerpo: { password } });
    const { secreto, qr } = respuesta;

    const modal = document.getElementById('modal-totp');
    const overlay = document.getElementById('modal-totp-overlay');
    const modalTitulo = document.getElementById('modal-totp-titulo');
    const modalDescripcion = document.getElementById('modal-totp-descripcion');
    const modalQr = document.getElementById('modal-totp-qr');
    const modalSecreto = document.getElementById('modal-totp-secreto');

    if (modal && overlay) {
      modalTitulo.textContent = 'Configurar Google Authenticator';
      modalDescripcion.textContent = 'Escanea este código QR con tu aplicación de autenticación (Google Authenticator, Authy, etc.)';
      modalQr.innerHTML = qr;
      modalQr.setAttribute('role', 'img');
      modalQr.setAttribute('aria-label', 'Código QR para Google Authenticator');
      modalSecreto.textContent = secreto;

      overlay.classList.remove('modal--hidden');
      document.body.style.overflow = 'hidden';
    }

    const btnConfirmar = document.getElementById('btn-confirmar-totp');
    const btnCancelar = document.getElementById('btn-cancelar-totp');

    if (btnConfirmar && btnCancelar) {
      const confirmarAccion = async () => {
        const codigoInput = document.getElementById('codigo-totp-verificar');
        const codigo = codigoInput?.value?.trim();

        if (!codigo || codigo.length !== 6) { mostrarError('El código debe tener 6 dígitos.'); return; }

        try {
          const resultado = await api('/usuarios/2fa/totp/confirmar', { metodo: 'POST', cuerpo: { codigo } });
          if (overlay) { overlay.classList.add('modal--hidden'); document.body.style.overflow = ''; }
          estado2FA.metodos.totp.activado = true;
          estado2FA.metodos.totp.activadoEn = new Date().toISOString();
          cargarSeccionSeguridad();
          avisarActivacionDeMetodo(resultado, 'Google Authenticator configurado correctamente.');
        } catch (error) {
          mostrarError(mensajeDeError(error, 'Código inválido. Inténtalo de nuevo.'));
          codigoInput.value = '';
          codigoInput.focus();
        }
      };

      btnConfirmar.onclick = async () => await confirmarAccion();
      btnCancelar.onclick = () => { if (overlay) { overlay.classList.add('modal--hidden'); document.body.style.overflow = ''; } };

      const codigoInput = document.getElementById('codigo-totp-verificar');
      if (codigoInput) {
        codigoInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarAccion(); } });
      }
    }
  } catch (error) {
    mostrarError(mensajeDeError(error, 'Error al iniciar configuración de Google Authenticator.'));
  }
}

async function generarCodigosRespaldo() {
  const password = await solicitarPassword('Ingresa tu contraseña para generar nuevos códigos de respaldo.');
  if (!password) return;

  try {
    const respuesta = await api('/usuarios/2fa/respaldo/generar', { metodo: 'POST', cuerpo: { password } });
    const { codigos } = respuesta;
    const modal = document.getElementById('modal-respaldo');
    const contenedorCodigos = document.getElementById('modal-respaldo-codigos');
    const overlay = document.getElementById('modal-respaldo-overlay');

    if (modal && overlay && contenedorCodigos) {
      contenedorCodigos.innerHTML = codigos.map((codigo, index) => `
        <div class="tarjeta" style="padding: 0.75rem; text-align: center; font-family: monospace; font-size: 0.875rem;">
          <code style="font-size: 1.1rem; letter-spacing: 0.2rem;">${codigo}</code>
          <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--color-texto-secundario);">#${index + 1}</div>
        </div>
      `).join('');

      overlay.classList.remove('modal--hidden');
      document.body.style.overflow = 'hidden';
      estado2FA.codigosRespaldo.generados = true;
      estado2FA.codigosRespaldo.restantes = codigos.length;

      const btnCerrar = document.getElementById('btn-cerrar-respaldo');
      if (btnCerrar) btnCerrar.onclick = () => { overlay.classList.add('modal--hidden'); document.body.style.overflow = ''; };
    }
    cargarSeccionSeguridad();
    mostrarAviso('Códigos de respaldo generados correctamente. Guárdalos en un lugar seguro.', 'exito');

  } catch (error) {
    mostrarError(mensajeDeError(error, 'Error al generar códigos de respaldo.'));
  }
}

/**
 * Registrar el dispositivo actual como de confianza.
 */
async function registrarDispositivoConfianza() {
  const password = await solicitarPassword('Ingresa tu contraseña para registrar este dispositivo como de confianza.');
  if (!password) return;
  try {
    const nombre = prompt('Ingresa un nombre para este dispositivo (opcional, ej: "Mi PC", "Laptop Trabajo"):');
    await api('/usuarios/2fa/dispositivos/confiar', { metodo: 'POST', cuerpo: { nombre: nombre || null, password } });
    mostrarAviso('Este dispositivo ha sido registrado como de confianza. No se te pedirá el 2FA durante 14 días.', 'exito');
    estado2FA.dispositivosConfianza += 1;
    cargarSeccionSeguridad();

  } catch (error) {
    mostrarError(mensajeDeError(error, 'Error al registrar dispositivo de confianza.'));
  }
}

/**
 * Listar dispositivos de confianza.
 */
async function listarDispositivosConfianza() {
  try {
    const respuesta = await api('/usuarios/2fa/dispositivos');
    const { dispositivos } = respuesta;
    if (dispositivos.length === 0) { mostrarAviso('No tienes dispositivos de confianza registrados.', 'info'); return; }
    const mensaje = dispositivos.map(d => `• ${d.nombre || 'Dispositivo sin nombre'} (${d.ipRegistro}) - ${new Date(d.expiraEn).toLocaleDateString(undefined, conZonaHoraria())}`).join('\n');
    alert(`Dispositivos de confianza:\n\n${mensaje}`);

  } catch (error) {
    mostrarError(mensajeDeError(error, 'Error al obtener dispositivos de confianza.'));
  }
}

/**
 * Activa el botón de eliminar solo cuando la frase y la contraseña están escritas.
 */
function actualizarBotonEliminar() {
  const frase = document.getElementById('eliminar-confirmacion')?.value ?? '';
  const password = document.getElementById('eliminar-password')?.value ?? '';
  const boton = document.getElementById('btn-eliminar-cuenta');
  if (boton) boton.disabled = frase !== FRASE_ELIMINAR_CUENTA || !password;
}

/**
 * Muestra los proyectos en los que la persona debe transferir su rol antes de eliminar la cuenta.
 * Los nombres se escriben con textContent para no interpretar HTML.
 *
 * @param {Array<{proyecto_id: number, nombre: string, rol: string}>} proyectos
 */
function mostrarRolesPorTransferir(proyectos) {
  const contenedor = document.getElementById('eliminar-pendientes');
  contenedor.replaceChildren();

  const titulo = document.createElement('p');
  titulo.textContent = 'Transfiere tu rol en estos proyectos y vuelve a intentarlo:';
  contenedor.appendChild(titulo);

  const lista = document.createElement('ul');
  proyectos.forEach((proyecto) => {
    const elemento = document.createElement('li');
    const rol = proyecto.rol === 'scrum_master' ? 'Scrum Master' : 'Product Owner';
    elemento.textContent = `${proyecto.nombre} (${rol}) · `;

    const enlace = document.createElement('a');
    enlace.href = `${RUTA_GESTION_MIEMBROS}?id=${encodeURIComponent(proyecto.proyecto_id)}`;
    enlace.className = 'enlace';
    enlace.textContent = 'Transferir rol';
    elemento.appendChild(enlace);

    lista.appendChild(elemento);
  });
  contenedor.appendChild(lista);

  contenedor.hidden = false;
}

/**
 * Configura el flujo para eliminar la cuenta: confirmación, contraseña y llamada al servidor.
 * Al terminar, el servidor ya cerró la sesión y limpió las cookies; se lleva a la persona al login.
 */
function configurarEliminarCuenta() {
  const formulario = document.getElementById('form-eliminar-cuenta');
  if (!formulario) return;

  document.getElementById('eliminar-confirmacion').addEventListener('input', actualizarBotonEliminar);
  document.getElementById('eliminar-password').addEventListener('input', actualizarBotonEliminar);

  // Consulta previa: avisar desde el inicio si hay roles por transferir, sin esperar
  // a que la persona escriba la frase y la contraseña. Si la consulta falla, el
  // servidor lo indicará igual al intentar eliminar (409 ROL_PENDIENTE_DE_TRANSFERIR).
  api('/usuarios/yo/roles-por-transferir')
    .then((datos) => {
      const proyectos = datos?.proyectos ?? [];
      if (proyectos.length > 0) mostrarRolesPorTransferir(proyectos);
    })
    .catch(() => { /* se informa al intentar eliminar */ });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const boton = document.getElementById('btn-eliminar-cuenta');
    const mensaje = document.getElementById('eliminar-mensaje');
    boton.disabled = true;
    mensaje.hidden = true;
    document.getElementById('eliminar-pendientes').hidden = true;

    try {
      await api('/usuarios/yo/eliminar', {
        metodo: 'POST',
        cuerpo: {
          confirmacion: document.getElementById('eliminar-confirmacion').value,
          password: document.getElementById('eliminar-password').value
        }
      });
      window.location.href = '/pages/login.html';
    } catch (error) {
      const codigo = error.cuerpo?.detalles?.codigo;
      if (codigo === 'ROL_PENDIENTE_DE_TRANSFERIR') {
        mostrarRolesPorTransferir(error.cuerpo.detalles.proyectos);
      }
      mensaje.textContent = mensajeDeError(error, 'No se pudo eliminar la cuenta. Inténtalo de nuevo.');
      mensaje.hidden = false;
      actualizarBotonEliminar();
    }
  });
}

/**
 * Inicializar el perfil al cargar la pagina.
 */
function init() {
  cargarInformacionUsuario();
  configurarFoto();
  configurarZona();
  configurarNotificaciones();
  configurarPreferenciasApp();
  configurarNavegacion();
  configurarModalRespaldo();
  configurarEliminarCuenta();
}

// Inicializar cuando el DOM este listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Exportar funciones para uso externo (si es necesario)
export { cargarInformacionUsuario, mostrarSeccion, cargarSeccionSeguridad };