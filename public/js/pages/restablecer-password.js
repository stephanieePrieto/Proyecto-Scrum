import { api } from '../core/api.js';

/**
 * @file restablecer-password.js
 * @description Lógica del lado del cliente para establecer una nueva contraseña mediante un token.
 * @author Citlaly Morales Viveros
 */

document.addEventListener('DOMContentLoaded', () => {
    const formulario = document.getElementById('form-restablecer');
    const alerta = document.getElementById('mensaje-alerta');

    const parametros = new URLSearchParams(window.location.search);
    const token = parametros.get('token');

    if (!token) {
        alerta.className = 'alerta-mensaje error';
        alerta.textContent = 'Token de recuperación no válido o ausente.';
        if (formulario) {
            const boton = formulario.querySelector('button');
            if (boton) boton.disabled = true;
        }
        return;
    }

    if (formulario) {
        formulario.addEventListener('submit', async (evento) => {
            evento.preventDefault();

            const nuevaPassword = document.getElementById('nueva-password').value;
            const confirmarPassword = document.getElementById('confirmar-password').value;

            if (nuevaPassword !== confirmarPassword) {
                alerta.className = 'alerta-mensaje error';
                alerta.textContent = 'Las contraseñas no coinciden.';
                return;
            }

            try {
                await api('/usuarios/restablecer-password', {
                    metodo: 'POST',
                    cuerpo: { token, nuevaPassword }
                });

                alerta.className = 'alerta-mensaje exito';
                alerta.textContent = 'Contraseña actualizada correctamente. Redirigiendo...';
                formulario.reset();

                setTimeout(() => {
                    window.location.href = '/login.html';
                }, 2000);
            } catch (error) {
                alerta.className = 'alerta-mensaje error';
                alerta.textContent = error.estado === 400
                    ? 'El enlace de recuperación ha expirado o es inválido.'
                    : 'Ocurrió un error al restablecer la contraseña.';
            }
        });
    }
});