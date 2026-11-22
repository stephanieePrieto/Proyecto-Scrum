/**
 * @file foco-atrapado.js
 * @description Atrapa Tab / Shift+Tab dentro de un diálogo propio (div con role="dialog").
 * Los <dialog> con showModal() ya lo hacen de forma nativa; esto es para los modales en div.
 * HU-49: accesibilidad por teclado.
 */

const SELECTOR_ENFOCABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * @param {HTMLElement} contenedor Diálogo que debe mantener el foco.
 * @returns {() => void} Función para soltar la trampa (es idempotente).
 */
export function atraparFoco(contenedor) {
  const alTabular = (evento) => {
    if (evento.key !== 'Tab' || !contenedor) return;
    const enfocables = [...contenedor.querySelectorAll(SELECTOR_ENFOCABLE)]
      .filter((el) => el.offsetParent !== null);
    if (enfocables.length === 0) {
      evento.preventDefault();
      return;
    }
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const dentro = contenedor.contains(document.activeElement);

    if (evento.shiftKey && (!dentro || document.activeElement === primero)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && (!dentro || document.activeElement === ultimo)) {
      evento.preventDefault();
      primero.focus();
    }
  };
  document.addEventListener('keydown', alTabular);
  return () => document.removeEventListener('keydown', alTabular);
}
