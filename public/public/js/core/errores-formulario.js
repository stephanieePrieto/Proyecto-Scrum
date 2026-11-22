/**
 * @file errores-formulario.js
 * @description Muestra y limpia errores de un campo de forma accesible (HU-49):
 * aria-invalid, aria-describedby hacia el mensaje, y el mensaje con role="alert".
 */

function idDeError(campo) {
  return `error-${campo.id || campo.name}`;
}

/**
 * @param {HTMLElement} campo Campo con error.
 * @param {string} texto Mensaje que leerá el lector de pantalla.
 */
export function marcarError(campo, texto) {
  if (!campo) return;
  const id = idDeError(campo);
  let aviso = document.getElementById(id);
  if (!aviso) {
    aviso = document.createElement('p');
    aviso.id = id;
    aviso.className = 'campo-error';
    aviso.setAttribute('role', 'alert');
    const ancla = campo.closest('.form-group, .form-check, label') || campo;
    ancla.insertAdjacentElement('afterend', aviso);
  }
  aviso.textContent = texto;
  campo.setAttribute('aria-invalid', 'true');
  const ids = new Set((campo.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
  ids.add(id);
  campo.setAttribute('aria-describedby', [...ids].join(' '));
}

/**
 * @param {HTMLElement} campo Campo cuyo error se quita.
 */
export function limpiarError(campo) {
  if (!campo) return;
  const id = idDeError(campo);
  document.getElementById(id)?.remove();
  campo.setAttribute('aria-invalid', 'false');
  const restantes = (campo.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== id);
  if (restantes.length) campo.setAttribute('aria-describedby', restantes.join(' '));
  else campo.removeAttribute('aria-describedby');
}

/**
 * Enlaza un campo con un aviso que ya existe en la página (por ejemplo, <p id="error-x" hidden>).
 * El aviso se anuncia con role="alert" y el campo lo lee con aria-describedby.
 * @param {HTMLElement} campo
 * @param {HTMLElement} aviso
 */
export function vincularAviso(campo, aviso) {
  if (!campo || !aviso) return;
  if (!aviso.id) aviso.id = idDeError(campo);
  aviso.setAttribute('role', 'alert');
  const ids = new Set((campo.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
  ids.add(aviso.id);
  campo.setAttribute('aria-describedby', [...ids].join(' '));
}
