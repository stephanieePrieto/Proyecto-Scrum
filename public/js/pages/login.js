import { api } from '../core/api.js';
import { mostrarAlerta } from '../core/auth.js';
localStorage.removeItem('proyectoActivo');

/**
 * @file login.js
 * @description Lógica del lado del cliente para la página de inicio de sesión y recuperación 2FA.
 * @author Citlaly Morales Viveros
 */

document.addEventListener('DOMContentLoaded', () => {
    const formulario = document.getElementById('form-login');
    const alerta = document.getElementById('mensaje-alerta');

    const inputPassword = document.getElementById('password');
    const btnTogglePassword = document.getElementById('btn-toggle-password');
    const iconoOjo = document.getElementById('icono-ojo');

    const btnIniciarRecuperacion = document.getElementById('btn-iniciar-recuperacion');
    const btnVolver2fa = document.getElementById('btn-volver-2fa');
    const vistaRecuperacion = document.getElementById('vista-recuperacion');
    const formulario2fa = document.getElementById('form-2fa');
    const contenedorMetodos = document.getElementById('metodos-2fa');
    const form2faYMetodos = [formulario2fa, contenedorMetodos, document.getElementById('opciones-2fa')];
    const btnAccionRecuperacion = document.getElementById('btn-accion-recuperacion');
    const textoRecuperacion = document.getElementById('texto-recuperacion');
    const alerta2fa = document.getElementById('mensaje-2fa-alerta');

    const urlParams = new URLSearchParams(window.location.search);
    const accionRecovery = urlParams.get('accion');
    const tokenRecovery = urlParams.get('token');

    if (accionRecovery && tokenRecovery) {
        const esConfirmacion = accionRecovery === 'confirmar_recuperacion';
        const endpoint = esConfirmacion ? '/recuperacion/confirmar' : '/recuperacion/cancelar';

        api(endpoint, { metodo: 'POST', cuerpo: { token: tokenRecovery } })
            .then(res => {
                mostrarAlerta(alerta, 'exito', res.mensaje);
                window.history.replaceState({}, document.title, window.location.pathname);
            })
            .catch(err => {
                mostrarAlerta(alerta, 'error', mensajeError2fa(err, 'El enlace es inválido o expiró.'));
            });
    }

    if (btnTogglePassword && inputPassword && iconoOjo) {
        btnTogglePassword.addEventListener('click', () => {
            const tipoActual = inputPassword.getAttribute('type');

            if (tipoActual === 'password') {
                inputPassword.setAttribute('type', 'text');

                iconoOjo.innerHTML = `
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                `;
                btnTogglePassword.setAttribute('aria-label', 'Ocultar contraseña');
            } else {
                inputPassword.setAttribute('type', 'password');

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

    function mensajeError2fa(error, predeterminado) {
        if (error.estado === 401) return 'Código inválido o expirado. Si el problema continúa, inicia sesión de nuevo.';
        if (error.estado === 429) return error.cuerpo?.mensaje || 'Demasiados intentos fallidos. Inténtalo de nuevo más tarde.';
        return predeterminado;
    }

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

        // Reset vistas de recuperación por si estaban abiertas
        vistaRecuperacion.style.display = 'none';
        form2faYMetodos.forEach(el => el && (el.style.display = ''));

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
            // El token temporal expira por sí solo
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

    // Eventos de Recuperación
    if (btnIniciarRecuperacion) {
        btnIniciarRecuperacion.addEventListener('click', async (e) => {
            e.preventDefault();
            form2faYMetodos.forEach(el => el && (el.style.display = 'none'));
            vistaRecuperacion.style.display = 'block';
            btnAccionRecuperacion.style.display = 'none';
            textoRecuperacion.textContent = 'Consultando estado...';

            try {
                const estado = await api('/recuperacion/estado', { metodo: 'GET' });

                if (!estado) {
                    textoRecuperacion.textContent = 'Al solicitar la recuperación, iniciará un periodo de espera de 24 horas por seguridad. Tras esto, se te enviará un enlace.';
                    btnAccionRecuperacion.textContent = 'Solicitar Recuperación';
                    btnAccionRecuperacion.style.display = 'block';
                    btnAccionRecuperacion.onclick = () => procesarRecuperacion('/recuperacion/solicitar');
                } else {
                    const esperaHasta = new Date(estado.espera_hasta);
                    if (new Date() < esperaHasta) {
                        textoRecuperacion.innerHTML = `Tienes una solicitud pendiente.<br>Podrás solicitar el enlace a partir del: <strong>${esperaHasta.toLocaleString()}</strong>`;
                        btnAccionRecuperacion.textContent = 'Reenviar aviso (60s)';
                        btnAccionRecuperacion.style.display = 'block';
                        btnAccionRecuperacion.onclick = () => procesarRecuperacion('/recuperacion/reenviar-aviso');
                    } else {
                        textoRecuperacion.textContent = 'El periodo de espera terminó. Haz clic abajo para recibir el enlace definitivo por correo.';
                        btnAccionRecuperacion.textContent = 'Enviar Enlace';
                        btnAccionRecuperacion.style.display = 'block';
                        btnAccionRecuperacion.onclick = () => procesarRecuperacion('/recuperacion/enviar-enlace');
                    }
                }
            } catch (err) {
                textoRecuperacion.textContent = 'Error al consultar estado. Inicia sesión de nuevo.';
            }
        });
    }

    if (btnVolver2fa) {
        btnVolver2fa.addEventListener('click', () => {
            vistaRecuperacion.style.display = 'none';
            form2faYMetodos.forEach(el => el && (el.style.display = ''));
        });
    }

    async function procesarRecuperacion(ruta) {
        btnAccionRecuperacion.disabled = true;
        try {
            const res = await api(ruta, { metodo: 'POST' });
            mostrarAlerta(alerta2fa, 'exito', res.mensaje);
            setTimeout(() => cancelarVerificacion2fa(), 3500);
        } catch (error) {
            mostrarAlerta(alerta2fa, 'error', mensajeError2fa(error, 'Ocurrió un error. Revisa el enfriamiento (60s) o vuelve a iniciar sesión.'));
            btnAccionRecuperacion.disabled = false;
        }
    }

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
            setTimeout(() => window.location.href = '/pages/dashboard.html', 1000);
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
                setTimeout(() => window.location.href = '/pages/dashboard.html', 1000);
            } catch (error) {
                let texto = 'Error al iniciar sesión. Inténtalo más tarde.';
                if (error.estado === 401) texto = 'Credenciales incorrectas o cuenta bloqueada.';
                else if (error.estado === 429) texto = 'Demasiados intentos fallidos. Inténtalo de nuevo más tarde.';

                mostrarAlerta(alerta, 'error', texto);
            }
        });
    }
});