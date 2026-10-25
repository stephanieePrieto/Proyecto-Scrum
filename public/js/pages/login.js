import { api } from '../core/api.js';

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

                alerta.className = 'alerta-mensaje exito';
                alerta.textContent = respuesta.mensaje || 'Inicio de sesión exitoso';

                setTimeout(() => {
                    window.location.href = '/pages/dashboard.html';
                }, 1000);
            } catch (error) {
                alerta.className = 'alerta-mensaje error';
                alerta.textContent = error.estado === 401
                    ? 'Credenciales incorrectas o cuenta bloqueada.'
                    : 'Error al iniciar sesión. Inténtalo más tarde.';
            }
        });
    }
});