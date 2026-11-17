/**
 * @file privacidad.js
 * @description Lógica de la página del aviso de privacidad. Muestra la versión vigente como párrafos de texto
 * y, cuando la cuenta debe aceptarla (parámetro pendiente=1), registra la aceptación.
 * El texto del servidor se escribe con textContent, nunca con innerHTML.
 *
 * @author Citlaly Morales Viveros
 */
import { api } from '../core/api.js';
import { mostrarAlerta } from '../core/auth.js';

/** Página a la que se lleva a la persona después de aceptar el aviso. */
const DESTINO_TRAS_ACEPTAR = '/pages/dashboard.html';

const pendiente = new URLSearchParams(window.location.search).get('pendiente') === '1';

const subtitulo = document.getElementById('subtitulo-aviso');
const mensaje = document.getElementById('mensaje');
const contenido = document.getElementById('contenido-aviso');
const bloqueAceptar = document.getElementById('bloque-aceptar');
const btnAceptar = document.getElementById('btn-aceptar');

let aviso = null;

/**
 * Agrega un párrafo al contenido. Los fragmentos entre ** se muestran en negrita.
 *
 * @param {string} texto Párrafo sin saltos de línea dobles.
 */
const agregarParrafo = (texto) => {
    const parrafo = document.createElement('p');
    texto.split('**').forEach((fragmento, indice) => {
        if (!fragmento) return;
        if (indice % 2 === 1) {
            const negrita = document.createElement('strong');
            negrita.textContent = fragmento;
            parrafo.appendChild(negrita);
        } else {
            parrafo.appendChild(document.createTextNode(fragmento));
        }
    });
    contenido.appendChild(parrafo);
};

/**
 * Separa el texto del aviso en párrafos, usando las líneas en blanco como separador.
 *
 * @param {string} texto Contenido completo de la versión vigente.
 */
const pintarAviso = (texto) => {
    texto.split(/\n\s*\n/)
        .map((bloque) => bloque.trim())
        .filter(Boolean)
        .forEach(agregarParrafo);
};

/**
 * Carga la versión vigente y, si la cuenta debe aceptarla, muestra el botón correspondiente.
 */
const cargarAviso = async () => {
    try {
        const respuesta = await api('/auth/aviso-privacidad');
        aviso = respuesta.aviso;
        const fecha = new Date(aviso.publicado_en).toLocaleDateString('es-MX');
        subtitulo.textContent = `Versión ${aviso.version}, publicada el ${fecha}`;
        pintarAviso(aviso.contenido);
        bloqueAceptar.hidden = !pendiente;
    } catch (error) {
        subtitulo.textContent = '';
        mostrarAlerta(mensaje, 'error', error.cuerpo?.mensaje || 'No se pudo cargar el aviso de privacidad.');
    }
};

btnAceptar.addEventListener('click', async () => {
    btnAceptar.disabled = true;
    try {
        await api('/auth/aviso-privacidad/aceptar', {
            metodo: 'POST',
            cuerpo: { version: aviso.version }
        });
        mostrarAlerta(mensaje, 'exito', 'Aceptaste el aviso de privacidad. Te llevamos a tu tablero.');
        window.location.href = DESTINO_TRAS_ACEPTAR;
    } catch (error) {
        mostrarAlerta(mensaje, 'error', error.cuerpo?.mensaje || 'No se pudo registrar tu aceptación.');
        btnAceptar.disabled = false;
    }
});

cargarAviso();
