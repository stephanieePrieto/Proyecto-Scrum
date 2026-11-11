/**
 * @file umbral.js
 * @description HU-33: configuración del umbral de desviación (solo Scrum Master).
 * @author Dana Carmona Santamaria
 */
import { api } from '../../core/api.js';

/**
 * Mostrar el formulario si el usuario puede editar, cargar el valor actual y guardar con validación.
 * Se puede llamar varias veces (al cambiar de proyecto) sin duplicar eventos.
 *
 * @param {number} proyectoId Identificador del proyecto activo.
 * @returns {Promise<void>}
 */
export async function iniciarUmbral(proyectoId) {
  const seccion = document.getElementById('seccion-umbral');
  const form = document.getElementById('umbral-form');
  const input = document.getElementById('umbral-valor');
  const mensaje = document.getElementById('umbral-mensaje');
  if (!seccion || !form || !input) return;

  // Mostrar un mensaje de éxito o de error bajo el formulario
  const avisar = (texto, tipo) => {
    mensaje.textContent = texto;
    mensaje.className = `alerta alerta--${tipo}`;
    mensaje.hidden = false;
  };

  // 1. Cargar el valor vigente; solo el Scrum Master ve la sección
  try {
    const { umbral, puedeEditar } = await api(`/metricas/proyectos/${proyectoId}/umbral`);
    seccion.hidden = !puedeEditar;
    input.value = umbral;
  } catch {
    seccion.hidden = true;
    return;
  }
  mensaje.hidden = true;

  // 2. Guardar con la misma validación que el servidor: entero entre 0 y 100
  form.onsubmit = async (e) => {
    e.preventDefault();
    mensaje.style.display = 'none';
    const valor = Number(input.value);
    if (input.value.trim() === '' || !Number.isInteger(valor) || valor < 0 || valor > 100) {
      return avisar('El umbral debe ser un número entero entre 0 y 100.', 'error');
    }
    try {
      await api(`/metricas/proyectos/${proyectoId}/umbral`, { metodo: 'PUT', cuerpo: { umbral: valor } });
      avisar(`Umbral guardado: ±${valor}%. Las tareas se reevaluaron con la nueva regla.`, 'exito');
    } catch (err) {
      avisar(err.cuerpo?.mensaje || err.message || 'No se pudo guardar el umbral.', 'error');
    }
  };
}