import { api } from '../core/api.js';
import { mostrarAlerta } from '../core/auth.js';

/**
 * @file recuperar-password.js
 * @description Lógica del lado del cliente para solicitar el token de recuperación de contraseña.
 * @author Citlaly Morales Viveros
 */

document.addEventListener('DOMContentLoaded', () => {
    const formulario = document.getElementById('form-recuperar');
    const alerta = document.getElementById('mensaje-alerta');

    if (formulario) {
        formulario.addEventListener('submit', async (evento) => {
            evento.preventDefault();

            const correo = document.getElementById('correo').value;

            try {
                await api('/usuarios/recuperar-password', {
                    metodo: 'POST',
                    cuerpo: { correo }
                });

                mostrarAlerta(alerta, 'exito', 'Si el correo existe, recibirás un enlace de recuperación pronto.');
                formulario.reset();
            } catch (error) {
                mostrarAlerta(alerta, 'error', 'Ocurrió un error al procesar la solicitud.');
            }
        });
    }
});