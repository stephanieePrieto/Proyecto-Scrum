import { api } from '/js/core/api.js';

/**
 * @file definir-password.js
 * @description Lógica de la pantalla para definir la contraseña de una cuenta nueva mediante el enlace recibido por correo.
 * @author Citlaly Morales Viveros
 */

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

if (!token) {
    document.getElementById('mensaje').innerHTML = `
        <div class="aviso error">
            <strong>Error:</strong> Token no proporcionado.
        </div>
    `;
    document.getElementById('formPassword').style.display = 'none';
} else {
    document.getElementById('formPassword').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

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
            await api.post('/api/usuarios/definir-password', { token, password });
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
                    <strong>Error:</strong> ${error.mensaje || 'No se pudo definir la contraseña.'}
                </div>
            `;
            btn.disabled = false;
            btn.textContent = 'Reintentar';
        }
    });
}