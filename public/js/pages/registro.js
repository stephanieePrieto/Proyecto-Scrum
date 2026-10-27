import { api } from '../core/api.js';
import { mostrarAlerta } from '../core/auth.js';

/**
 * @file registro.js
 * @description Lógica del lado del cliente para la página de registro de usuarios.
 * @author Citlaly Morales Viveros
 */

document.addEventListener('DOMContentLoaded', () => {
    const formulario = document.getElementById('form-registro');
    const alerta = document.getElementById('mensaje-alerta');

    if (formulario) {
        formulario.addEventListener('submit', async (evento) => {
            evento.preventDefault();

            const nombre = document.getElementById('nombre').value;
            const correo = document.getElementById('correo').value;
            const password = document.getElementById('password').value;

            try {
                const respuesta = await api('/auth/register', {
                    metodo: 'POST',
                    cuerpo: { nombre, correo, password }
                });

                mostrarAlerta(alerta, 'exito', respuesta.mensaje || 'Cuenta creada con éxito. Redirigiendo...');

                setTimeout(() => {
                    window.location.href = '/pages/login.html';
                }, 1500);
            } catch (error) {
                let texto = 'Error al registrar la cuenta. Inténtalo más tarde.';
                if (error.estado === 400) {
                    texto = error.mensaje || 'Datos inválidos o el correo ya está registrado.';
                }

                mostrarAlerta(alerta, 'error', texto);
            }
        });
    }
});