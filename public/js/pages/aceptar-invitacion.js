/**
 * @file aceptar-invitacion.js
 * @description Lógica de la pantalla para aceptar una invitación, definir contraseña y aceptar el aviso de privacidad.
 * @author Citlaly Morales Viveros
 */

import { api } from '../core/api.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

const btnAceptar = document.getElementById('btnAceptar');
const btnRechazar = document.getElementById('btnRechazar');
const mensaje = document.getElementById('mensaje');
const contenido = document.getElementById('contenido');

/**
 * Muestra un aviso de éxito o error en pantalla.
 * @param {string} tipo - 'exito' o 'error'.
 * @param {string} texto - Mensaje a mostrar.
 */
function mostrarMensaje(tipo, texto) {
    mensaje.className = `aviso aviso--${tipo}`;
    mensaje.innerHTML = `<strong>${tipo === 'exito' ? '¡Éxito!' : 'Error:'}</strong> ${texto}`;
    mensaje.hidden = false;
}

if (!token) {
    mostrarMensaje('error', 'Token de invitación no proporcionado o inválido.');
    if (contenido) contenido.style.display = 'none';
} else {
    btnAceptar?.addEventListener('click', async () => {
        btnAceptar.disabled = true;
        btnRechazar.disabled = true;
        btnAceptar.textContent = 'Procesando...';

        try {
            const respuesta = await api('/invitaciones/aceptar', {
                metodo: 'POST',
                cuerpo: { token }
            });
            mostrarMensaje('exito', respuesta.mensaje || 'Invitación aceptada correctamente.');
            contenido.innerHTML = `
                <p>Serás redirigido al inicio de sesión en unos segundos...</p>
            `;
            setTimeout(() => {
                window.location.href = '/pages/login.html';
            }, 3000);
        } catch (error) {
            mostrarMensaje('error', error.cuerpo?.mensaje || 'No se pudo aceptar la invitación. Inicia sesión si ya tienes cuenta e intenta de nuevo.');
            btnAceptar.disabled = false;
            btnRechazar.disabled = false;
            btnAceptar.textContent = 'Aceptar Invitación';
        }
    });

    btnRechazar?.addEventListener('click', async () => {
        btnAceptar.disabled = true;
        btnRechazar.disabled = true;
        btnRechazar.textContent = 'Procesando...';

        try {
            const respuesta = await api('/invitaciones/rechazar', {
                metodo: 'POST',
                cuerpo: { token }
            });
            mostrarMensaje('exito', respuesta.mensaje || 'Invitación rechazada correctamente.');
            contenido.innerHTML = `
                <p>Has rechazado la invitación. Puedes cerrar esta ventana.</p>
            `;
        } catch (error) {
            mostrarMensaje('error', error.cuerpo?.mensaje || 'No se pudo rechazar la invitación.');
            btnAceptar.disabled = false;
            btnRechazar.disabled = false;
            btnRechazar.textContent = 'Rechazar';
        }
    });
}