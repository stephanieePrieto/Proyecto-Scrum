import { api } from '../core/api.js';
import { mostrarAlerta } from '../core/auth.js';

/**
 * @file login.js
 * @description Lógica del lado del cliente para la página de inicio de sesión.
 * @author Citlaly Morales Viveros
 */

document.addEventListener('DOMContentLoaded', () => {
    const formulario = document.getElementById('form-login');
    const alerta = document.getElementById('mensaje-alerta');

    const inputPassword = document.getElementById('password');
    const btnTogglePassword = document.getElementById('btn-toggle-password');
    const iconoOjo = document.getElementById('icono-ojo');

    // Lógica para alternar la visibilidad de la contraseña con el icono SVG estilo minimalista
    if (btnTogglePassword && inputPassword && iconoOjo) {
        btnTogglePassword.addEventListener('click', () => {
            const tipoActual = inputPassword.getAttribute('type');

            if (tipoActual === 'password') {
                inputPassword.setAttribute('type', 'text');
                // Cambiar a SVG de ojo abierto
                iconoOjo.innerHTML = `
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                `;
                btnTogglePassword.setAttribute('aria-label', 'Ocultar contraseña');
            } else {
                inputPassword.setAttribute('type', 'password');
                // Cambiar a SVG de ojo tachado
                iconoOjo.innerHTML = `
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                `;
                btnTogglePassword.setAttribute('aria-label', 'Mostrar contraseña');
            }
        });
    }

    if (formulario) {
        formulario.addEventListener('submit', async (evento) => {
            evento.preventDefault();

            const correo = document.getElementById('correo').value;
            const password = inputPassword.value;

            try {
                const respuesta = await api('/auth/login', {
                    metodo: 'POST',
                    cuerpo: { correo, password }
                });

                mostrarAlerta(alerta, 'exito', respuesta.mensaje || 'Inicio de sesión exitoso');

                setTimeout(() => {
                    window.location.href = '/pages/dashboard.html';
                }, 1000);
            } catch (error) {
                let texto = 'Error al iniciar sesión. Inténtalo más tarde.';
                if (error.estado === 401) texto = 'Credenciales incorrectas o cuenta bloqueada.';
                else if (error.estado === 429) texto = 'Demasiados intentos fallidos. Inténtalo de nuevo más tarde.';

                mostrarAlerta(alerta, 'error', texto);
            }
        });
    }
});