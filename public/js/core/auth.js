import { api } from './api.js';

/**
 * @file auth.js
 * @description Funciones centrales para la gestión de sesión en el frontend.
 * @author Citlaly Morales Viveros
 */

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
        window.location.href = '/login.html';
    }
}