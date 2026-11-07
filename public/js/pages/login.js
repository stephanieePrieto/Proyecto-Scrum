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

    const modal2fa = document.getElementById('modal-2fa');
    const fondoModal2fa = document.getElementById('modal-2fa-fondo');
    const formulario2fa = document.getElementById('form-2fa');
    const alerta2fa = document.getElementById('mensaje-2fa-alerta');
    const contenedorMetodos = document.getElementById('metodos-2fa');
    const inputCodigo = document.getElementById('codigo-2fa');
    const casillaConfiar = document.getElementById('confiar-dispositivo');
    const contenedorNombre = document.getElementById('nombre-dispositivo-container');
    const inputNombre = document.getElementById('nombre-dispositivo');
    const btnCancelar2fa = document.getElementById('btn-cancelar-2fa');
    const btnRespaldo = document.getElementById('btn-codigo-respaldo');

    const ETIQUETAS_METODOS = {
        totp: 'Aplicación de autenticación',
        correo: 'Código por correo'
    };

    let metodosDisponibles = [];
    let metodoActual = null;

    /**
     * Traduce un error de las rutas de 2FA a un mensaje para la persona usuaria.
     *
     * @param {{estado?: number}} error - Error lanzado por la petición.
     * @param {string} predeterminado - Mensaje para los casos no contemplados.
     * @returns {string} Mensaje a mostrar.
     */
    const mensajeError2fa = (error, predeterminado) => {
        if (error.estado === 401) return 'Código inválido o expirado. Si el problema continúa, inicia sesión de nuevo.';
        if (error.estado === 429) return 'Demasiados intentos fallidos. Inténtalo de nuevo más tarde.';
        return predeterminado;
    };

    /**
     * Dibuja los botones para elegir el método de verificación cuando hay más de uno.
     * Con el código de respaldo activo no se resalta ningún botón.
     */
    const dibujarMetodos = () => {
        contenedorMetodos.replaceChildren();

        if (metodosDisponibles.length < 2) return;

        metodosDisponibles.forEach((metodo) => {
            const boton = document.createElement('button');
            const activo = metodo === metodoActual;

            boton.type = 'button';
            boton.className = `boton ${activo ? 'boton--primario' : 'boton--secundario'}`;
            boton.style.marginRight = '0.5rem';
            boton.textContent = ETIQUETAS_METODOS[metodo] || metodo;
            boton.addEventListener('click', () => seleccionarMetodo(metodo));

            contenedorMetodos.appendChild(boton);
        });
    };

    /**
     * Ajusta el campo del código según el método: seis dígitos para TOTP y correo,
     * formato XXX-XXX-XXX para los códigos de respaldo.
     *
     * @param {string} metodo - Método de verificación activo.
     */
    const configurarCampoCodigo = (metodo) => {
        inputCodigo.value = '';

        if (metodo === 'respaldo') {
            inputCodigo.removeAttribute('pattern');
            inputCodigo.setAttribute('inputmode', 'text');
            inputCodigo.setAttribute('maxlength', '11');
            inputCodigo.setAttribute('placeholder', 'XXX-XXX-XXX');
            btnRespaldo.textContent = 'Usar otro método de verificación';
        } else {
            inputCodigo.setAttribute('pattern', '[0-9]{6}');
            inputCodigo.setAttribute('inputmode', 'numeric');
            inputCodigo.setAttribute('maxlength', '6');
            inputCodigo.setAttribute('placeholder', '123456');
            btnRespaldo.textContent = 'Usar código de respaldo';
        }
    };

    /**
     * Pide al servidor que envíe el código de verificación al correo de la cuenta.
     * El envío es independiente de la verificación, que se hace con otra ruta.
     */
    const solicitarCodigoCorreo = async () => {
        try {
            const respuesta = await api('/auth/2fa/solicitar-correo', {
                metodo: 'POST',
                cuerpo: {}
            });

            mostrarAlerta(alerta2fa, 'exito', respuesta.mensaje || 'Código enviado a tu correo electrónico');
        } catch (error) {
            mostrarAlerta(alerta2fa, 'error', mensajeError2fa(error, 'No se pudo enviar el código al correo. Inténtalo más tarde.'));
        }
    };

    /**
     * Activa un método de verificación en el modal. Si es el correo, solicita el envío del código.
     *
     * @param {string} metodo - 'totp', 'correo' o 'respaldo'.
     */
    const seleccionarMetodo = async (metodo) => {
        metodoActual = metodo;
        alerta2fa.hidden = true;

        configurarCampoCodigo(metodo);
        dibujarMetodos();
        inputCodigo.focus();

        if (metodo === 'correo') {
            await solicitarCodigoCorreo();
        }
    };

    /**
     * Muestra el modal de verificación en dos pasos con los métodos que la cuenta tiene activos.
     *
     * @param {string[]} metodos - Métodos devueltos por el servidor tras validar la contraseña.
     */
    const abrirModal2fa = (metodos) => {
        metodosDisponibles = Array.isArray(metodos) ? metodos : [];

        casillaConfiar.checked = false;
        contenedorNombre.style.display = 'none';
        inputNombre.value = '';

        modal2fa.hidden = false;
        seleccionarMetodo(metodosDisponibles[0] || 'respaldo');
    };

    /**
     * Cierra el modal. Al cancelar, se cierra también el token temporal del servidor
     * para que no quede un paso pendiente de verificación.
     */
    const cancelarVerificacion2fa = async () => {
        modal2fa.hidden = true;
        formulario2fa.reset();
        inputCodigo.value = '';
        inputPassword.value = '';

        try {
            await api('/auth/logout', { metodo: 'POST', cuerpo: {} });
        } catch (error) {
            // El token temporal expira por sí solo si no se pudo limpiar ahora
        }
    };

    casillaConfiar.addEventListener('change', () => {
        contenedorNombre.style.display = casillaConfiar.checked ? 'block' : 'none';
    });

    btnRespaldo.addEventListener('click', (evento) => {
        evento.preventDefault();

        if (metodoActual === 'respaldo') {
            seleccionarMetodo(metodosDisponibles[0] || 'totp');
        } else {
            seleccionarMetodo('respaldo');
        }
    });

    btnCancelar2fa.addEventListener('click', cancelarVerificacion2fa);
    fondoModal2fa.addEventListener('click', cancelarVerificacion2fa);

    formulario2fa.addEventListener('submit', async (evento) => {
        evento.preventDefault();

        const cuerpo = {
            codigo: inputCodigo.value.trim(),
            confiarDispositivo: casillaConfiar.checked
        };

        if (casillaConfiar.checked && inputNombre.value.trim()) {
            cuerpo.nombreDispositivo = inputNombre.value.trim();
        }

        let ruta = '/auth/2fa/verificar-correo';
        if (metodoActual !== 'correo') {
            ruta = '/auth/2fa/verificar';
            cuerpo.metodo = metodoActual;
        }

        try {
            const respuesta = await api(ruta, { metodo: 'POST', cuerpo });

            mostrarAlerta(alerta2fa, 'exito', respuesta.mensaje || 'Verificación exitosa');

            setTimeout(() => {
                window.location.href = '/pages/dashboard.html';
            }, 1000);
        } catch (error) {
            mostrarAlerta(alerta2fa, 'error', mensajeError2fa(error, 'Error al verificar el código. Inténtalo más tarde.'));
        }
    });

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

                if (respuesta.requiere2fa) {
                    abrirModal2fa(respuesta.metodos);
                    return;
                }

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