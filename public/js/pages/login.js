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

    if (formulario) {
        formulario.addEventListener('submit', async (evento) => {
            evento.preventDefault();

            const correo = document.getElementById('correo').value;
            const password = document.getElementById('password').value;

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