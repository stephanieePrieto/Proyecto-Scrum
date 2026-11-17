/**
 * @file definir-password.js
 * @description Lógica de la pantalla para definir la contraseña de una cuenta nueva mediante el enlace recibido por correo.
 * 
 * @author Citlaly Morales Viveros
 */
import { api } from '../core/api.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

let avisoVigente = null;

/**
 * Carga la versión vigente del aviso de privacidad. Sin ella no se puede definir la contraseña.
 */
const cargarAviso = async () => {
    try {
        const respuesta = await api('/auth/aviso-privacidad');
        avisoVigente = respuesta.aviso;
    } catch (error) {
        document.getElementById('mensaje').innerHTML = `
            <div class="aviso error">
                <strong>Error:</strong> No se pudo cargar el aviso de privacidad. Inténtalo más tarde.
            </div>
        `;
        document.querySelector('button[type="submit"]').disabled = true;
    }
};

if (!token) {
    document.getElementById('mensaje').innerHTML = `
        <div class="aviso error">
            <strong>Error:</strong> Token no proporcionado.
        </div>
    `;
    document.getElementById('formPassword').style.display = 'none';
} else {
    cargarAviso();

    document.getElementById('formPassword').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (!avisoVigente) {
            document.getElementById('mensaje').innerHTML = `
                <div class="aviso error">
                    <strong>Error:</strong> El aviso de privacidad no está disponible.
                </div>
            `;
            return;
        }

        if (!document.getElementById('aceptoAviso').checked) {
            document.getElementById('mensaje').innerHTML = `
                <div class="aviso error">
                    <strong>Error:</strong> Debes aceptar el aviso de privacidad.
                </div>
            `;
            return;
        }

        if (password !== confirmPassword) {
            document.getElementById('mensaje').innerHTML = `
                <div class="aviso error">
                    <strong>Error:</strong> Las contraseñas no coinciden.
                </div>
            `;
            return;
        }

        const btn = document.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Procesando...';

        try {
            // Usar la función 'api' directamente y remover el prefijo '/api' de la ruta
            await api('/usuarios/definir-password', {
                metodo: 'POST',
                cuerpo: { token, password, aceptoAviso: true, versionAviso: avisoVigente.version }
            });

            document.getElementById('mensaje').innerHTML = `
                <div class="aviso exito">
                    <strong>¡Éxito!</strong> Contraseña definida correctamente. Ahora puedes iniciar sesión.
                </div>
            `;
            document.getElementById('formPassword').innerHTML = `
                <p>Serás redirigido al inicio de sesión en 3 segundos...</p>
            `;
            setTimeout(() => {
                window.location.href = '/pages/login.html';
            }, 3000);
        } catch (error) {
            document.getElementById('mensaje').innerHTML = `
                <div class="aviso error">
                    <strong>Error:</strong> ${error.cuerpo?.mensaje || 'No se pudo definir la contraseña.'}
                </div>
            `;
            btn.disabled = false;
            btn.textContent = 'Reintentar';
        }
    });
}