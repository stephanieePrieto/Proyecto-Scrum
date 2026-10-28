// Responsable: Citlaly - HU-39, HU-57: logica de la pantalla para aceptar una invitacion, definir contrasena y aceptar el aviso de privacidad

import { api } from '/js/core/api.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

if (!token) {
    document.getElementById('mensaje').innerHTML = `
        <div class="aviso error">
            <strong>Error:</strong> Token de invitación no proporcionado.
        </div>
    `;
    document.getElementById('contenido').style.display = 'none';
} else {
    document.getElementById('btnAceptar').addEventListener('click', async () => {
        const btn = document.getElementById('btnAceptar');
        btn.disabled = true;
        btn.textContent = 'Procesando...';

        try {
            const respuesta = await api.post('/api/invitaciones/aceptar', { token });
            document.getElementById('mensaje').innerHTML = `
                <div class="aviso exito">
                    <strong>¡Éxito!</strong> ${respuesta.mensaje}
                </div>
            `;
            document.getElementById('contenido').innerHTML = `
                <p>Serás redirigido al inicio de sesión en 3 segundos...</p>
            `;
            setTimeout(() => {
                window.location.href = '/pages/login.html';
            }, 3000);
        } catch (error) {
            document.getElementById('mensaje').innerHTML = `
                <div class="aviso error">
                    <strong>Error:</strong> ${error.mensaje || 'No se pudo aceptar la invitación.'}
                </div>
            `;
            btn.disabled = false;
            btn.textContent = 'Reintentar';
        }
    });
}