/**
 * @file registro.js
 * @description Lógica del lado del cliente para la página de registro de usuarios.
 * 
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */
import { api } from '../core/api.js';
import { mostrarAlerta } from '../core/auth.js';

document.addEventListener('DOMContentLoaded', () => {
    const formulario = document.getElementById('form-registro');
    const alerta = document.getElementById('mensaje-alerta');
    const inputPassword = document.getElementById('password');
    let avisoVigente = null;

    /**
     * Carga la versión vigente del aviso de privacidad. Sin ella no se puede completar el registro.
     */
    const cargarAviso = async () => {
        try {
            const respuesta = await api('/auth/aviso-privacidad');
            avisoVigente = respuesta.aviso;
        } catch (error) {
            mostrarAlerta(alerta, 'error', 'No se pudo cargar el aviso de privacidad. Inténtalo más tarde.');
            formulario.querySelector('button[type="submit"]').disabled = true;
        }
    };
    cargarAviso();

    // Elementos de la lista de requisitos
    const reqLongitud = document.getElementById('req-longitud');
    const reqMayuscula = document.getElementById('req-mayuscula');
    const reqMinuscula = document.getElementById('req-minuscula');
    const reqNumero = document.getElementById('req-numero');

    // Validación visual en tiempo real mientras escribe la contraseña
    if (inputPassword) {
        inputPassword.addEventListener('input', () => {
            const valor = inputPassword.value;

            // 1. Longitud >= 8
            if (valor.length >= 8) {
                reqLongitud.classList.add('valido');
            } else {
                reqLongitud.classList.remove('valido');
            }

            // 2. Al menos una mayúscula
            if (/[A-Z]/.test(valor)) {
                reqMayuscula.classList.add('valido');
            } else {
                reqMayuscula.classList.remove('valido');
            }

            // 3. Al menos una minúscula
            if (/[a-z]/.test(valor)) {
                reqMinuscula.classList.add('valido');
            } else {
                reqMinuscula.classList.remove('valido');
            }

            // 4. Al menos un número
            if (/\d/.test(valor)) {
                reqNumero.classList.add('valido');
            } else {
                reqNumero.classList.remove('valido');
            }
        });
    }

    if (formulario) {
        formulario.addEventListener('submit', async (evento) => {
            evento.preventDefault();

            const nombre = document.getElementById('nombre').value;
            const correo = document.getElementById('correo').value;
            const password = inputPassword.value;
            const confirmarPassword = document.getElementById('confirmar-password').value;

            if (!avisoVigente) {
                mostrarAlerta(alerta, 'error', 'El aviso de privacidad no está disponible. Inténtalo más tarde.');
                return;
            }

            if (!document.getElementById('acepto-aviso').checked) {
                mostrarAlerta(alerta, 'error', 'Debes aceptar el aviso de privacidad para crear tu cuenta.');
                return;
            }

            // Validar que las contraseñas coincidan
            if (password !== confirmarPassword) {
                mostrarAlerta(alerta, 'error', 'Las contraseñas no coinciden.');
                return;
            }

            // Validar reglas finales de seguridad
            const regexPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
            if (!regexPassword.test(password)) {
                mostrarAlerta(alerta, 'error', 'La contraseña no cumple con todos los requisitos de seguridad.');
                return;
            }

            try {
                const respuesta = await api('/auth/register', {
                    metodo: 'POST',
                    cuerpo: { nombre, correo, password, aceptoAviso: true, versionAviso: avisoVigente.version }
                });

                mostrarAlerta(alerta, 'exito', respuesta.mensaje || 'Cuenta creada con éxito. Redirigiendo al inicio de sesión...');

                setTimeout(() => {
                    window.location.href = '/pages/login.html';
                }, 2000);
            } catch (error) {
                let texto = 'Error al registrar la cuenta. Inténtalo más tarde.';
                if (error.estado === 400) {
                    texto = error.mensaje || 'Datos inválidos o el correo ya está registrado.';
                }
                if (error.estado === 409) {
                    texto = 'El aviso de privacidad cambió. Recarga la página para revisarlo y aceptarlo.';
                }

                mostrarAlerta(alerta, 'error', texto);
            }
        });
    }
});