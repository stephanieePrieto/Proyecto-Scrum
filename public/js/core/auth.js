/**
 * @file auth.js
 * @description Funciones centrales para la gestión de sesión en el frontend.
 * 
 * @author Stephanie Elizdeth Hernández Prieto
 * @author Citlaly Morales Viveros
 */
import { api } from './api.js';

/**
 * Cierra la sesión del usuario actual comunicándose con el backend y redirige al login.
 * @returns {Promise<void>}
 */
export async function cerrarSesion() {
    try {
        await api('/auth/logout', { metodo: 'POST' });
    } catch (error) {
        console.error('Error al cerrar sesión', error);
    } finally {
        try {
            localStorage.removeItem('usuario');
            // No dejar el proyecto activo guardado tras cerrar sesión
            localStorage.removeItem('proyectoActivo');
        } catch { /* Sin almacenamiento: no hay datos que borrar */ }
        window.location.href = '/pages/login.html';
    }
}

/**
 * Mostrar un mensaje de éxito o de error en el contenedor de alertas de la página.
 *
 * @param {HTMLElement} alerta - Contenedor del mensaje.
 * @param {'exito'|'error'} tipo - Tono del mensaje.
 * @param {string} texto - Texto a mostrar.
 * @returns {void}
 */
export function mostrarAlerta(alerta, tipo, texto) {
    alerta.className = `alerta alerta--${tipo}`;
    alerta.textContent = texto;
    alerta.hidden = false;
}