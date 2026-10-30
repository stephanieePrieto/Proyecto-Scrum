// Responsable: Alfonso - HU-20: adjuntos del detalle de tarjeta (limite de 10 MB por archivo)
/**
 * @file adjuntos.js
 * @description Lista, sube, descarga y elimina adjuntos. Valida el límite de 10 MB y los tipos no permitidos
 *              antes de subir; si la subida falla conserva el archivo elegido y ofrece "Reintentar".
 */
import { api } from '../../core/api.js';
import {
  crear,
  crearAviso,
  mensajeError,
  formatearFecha,
  formatearTamano,
  LIMITE_ADJUNTO_BYTES,
  EXTENSIONES_BLOQUEADAS,
} from './dom.js';

/**
 * Revisa un archivo antes de subirlo.
 * @param {File} archivo Archivo elegido.
 * @returns {string|null} Mensaje de error o `null` si es válido.
 */
function validar(archivo) {
  if (archivo.size > LIMITE_ADJUNTO_BYTES) {
    return `«${archivo.name}» pesa ${formatearTamano(archivo.size)} y supera el límite de 10 MB. Elige un archivo más pequeño.`;
  }
  if (archivo.size === 0) return `«${archivo.name}» está vacío.`;
  const posicionPunto = archivo.name.lastIndexOf('.');
  const extension = posicionPunto >= 0 ? archivo.name.slice(posicionPunto).toLowerCase() : '';
  if (EXTENSIONES_BLOQUEADAS.has(extension)) {
    return `«${archivo.name}» no está permitido: los ejecutables y scripts no se pueden adjuntar.`;
  }
  return null;
}

/**
 * Monta la sección de adjuntos dentro de un contenedor.
 * @param {HTMLElement} contenedor Sección donde se dibuja.
 * @param {number} tareaId Tarjeta.
 * @param {{alCambiar?: function(): void}} [opciones] `alCambiar` se llama tras subir o eliminar (refresca el historial).
 */
export function montarAdjuntos(contenedor, tareaId, { alCambiar = () => {} } = {}) {
  let adjuntos = [];
  let pendiente = null;
  let subiendo = false;

  const contador = crear('span', { clase: 'dt-contador' });
  const lista = crear('ul', { clase: 'dt-adjuntos__lista' });
  const avisoCarga = crearAviso();
  const avisoSubida = crearAviso();
  const estado = crear('span', { clase: 'dt-contador', atributos: { role: 'status' } });

  const entrada = crear('input', { atributos: { type: 'file', hidden: true, 'aria-label': 'Seleccionar archivo' } });
  const botonAdjuntar = crear('button', {
    clase: 'dt-boton dt-boton--secundario',
    texto: '📎 Adjuntar archivo',
    atributos: { type: 'button' },
    eventos: { click: () => entrada.click() },
  });

  /** Dibuja la lista de adjuntos. */
  function pintar() {
    contador.textContent = adjuntos.length ? `(${adjuntos.length})` : '';
    if (adjuntos.length === 0) {
      lista.replaceChildren(crear('li', { clase: 'dt-vacio', texto: 'Sin adjuntos.' }));
      return;
    }
    lista.replaceChildren(...adjuntos.map((adjunto) => {
      const botonEliminar = crear('button', {
        clase: 'dt-boton dt-boton--peligro dt-boton--pequeno',
        texto: 'Eliminar',
        atributos: { type: 'button', 'aria-label': `Eliminar el adjunto ${adjunto.nombre}` },
      });
      botonEliminar.addEventListener('click', () => eliminar(adjunto, botonEliminar));

      return crear('li', { clase: 'dt-adjunto' }, [
        crear('span', { clase: 'dt-adjunto__icono', texto: '📄', atributos: { 'aria-hidden': 'true' } }),
        crear('div', { clase: 'dt-adjunto__datos' }, [
          crear('a', {
            clase: 'dt-adjunto__nombre',
            texto: adjunto.nombre,
            atributos: { href: `/api/adjuntos/${adjunto.id}/descargar`, download: adjunto.nombre },
          }),
          crear('span', {
            clase: 'dt-adjunto__meta',
            texto: `${formatearTamano(adjunto.tamano)} · ${adjunto.autor.nombre} · ${formatearFecha(adjunto.creadoEn)}`,
          }),
        ]),
        adjunto.puedeEliminar ? botonEliminar : null,
      ]);
    }));
  }

  /** Carga los adjuntos de la tarjeta. */
  async function cargar() {
    avisoCarga.ocultar();
    lista.replaceChildren(crear('li', { clase: 'dt-vacio', texto: 'Cargando adjuntos…' }));
    try {
      const respuesta = await api(`/adjuntos/tarea/${tareaId}`);
      adjuntos = respuesta.datos.adjuntos;
      pintar();
    } catch (error) {
      lista.replaceChildren();
      avisoCarga.mostrar(
        mensajeError(error, 'No se pudieron cargar los adjuntos.'),
        [{ texto: 'Reintentar', alClick: cargar }],
      );
    }
  }

  /** Descarta el archivo que falló al subir. */
  function descartar() {
    pendiente = null;
    avisoSubida.ocultar();
  }

  /** Sube el archivo pendiente. Si falla, lo conserva para reintentar. */
  async function subir() {
    if (!pendiente || subiendo) return;
    const archivo = pendiente;
    subiendo = true;
    botonAdjuntar.disabled = true;
    estado.textContent = `Subiendo «${archivo.name}»…`;
    avisoSubida.ocultar();

    const datos = new FormData();
    datos.append('archivo', archivo);
    try {
      const respuesta = await api(`/adjuntos/tarea/${tareaId}`, { metodo: 'POST', cuerpo: datos });
      adjuntos.unshift(respuesta.datos.adjunto);
      pendiente = null;
      pintar();
      alCambiar();
    } catch (error) {
      const reintentable = ![400, 413, 415].includes(error.estado);
      const botones = reintentable ? [{ texto: 'Reintentar', alClick: subir }] : [];
      botones.push({ texto: 'Descartar', alClick: descartar });
      avisoSubida.mostrar(mensajeError(error, `No se pudo subir «${archivo.name}».`), botones);
    } finally {
      subiendo = false;
      botonAdjuntar.disabled = false;
      estado.textContent = '';
    }
  }

  /** Valida el archivo elegido y empieza la subida. */
  function seleccionar(archivo) {
    const problema = validar(archivo);
    if (problema) {
      pendiente = null;
      avisoSubida.mostrar(problema, [{ texto: 'Entendido', alClick: () => avisoSubida.ocultar() }]);
      return;
    }
    pendiente = archivo;
    subir();
  }

  /** Elimina un adjunto tras confirmar. */
  async function eliminar(adjunto, boton) {
    if (!window.confirm(`¿Eliminar el adjunto «${adjunto.nombre}»?`)) return;
    boton.disabled = true;
    try {
      await api(`/adjuntos/${adjunto.id}`, { metodo: 'DELETE' });
      adjuntos = adjuntos.filter((a) => a.id !== adjunto.id);
      pintar();
      alCambiar();
    } catch (error) {
      boton.disabled = false;
      avisoSubida.mostrar(mensajeError(error, 'No se pudo eliminar el adjunto.'));
    }
  }

  entrada.addEventListener('change', () => {
    const archivo = entrada.files?.[0];
    entrada.value = '';
    if (archivo) seleccionar(archivo);
  });

  contenedor.replaceChildren(
    crear('h3', { clase: 'dt-seccion__titulo' }, ['Adjuntos', contador]),
    avisoCarga.nodo,
    lista,
    crear('div', { clase: 'dt-fila' }, [botonAdjuntar, estado, entrada]),
    crear('p', { clase: 'dt-ayuda', texto: 'Máximo 10 MB por archivo.' }),
    avisoSubida.nodo,
  );

  cargar();
}