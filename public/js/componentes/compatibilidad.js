// Responsable: Alfonso - HU-52: detecta si el navegador puede usar ScrumFlow y, si no, lo lleva al aviso de compatibilidad
/**
 * @file compatibilidad.js
 * @description Script clásico (sintaxis ES5, sin import) que cada página carga en el <head>, antes de sus
 * módulos. Un navegador antiguo no ejecuta <script type="module">, así que esta revisión no puede ser un módulo.
 *
 * Revisa características, no versiones del navegador:
 *   - Módulos ES, fetch, Promise y WebSocket.
 *   - Variables CSS y métodos del DOM que usan las pantallas (closest, replaceChildren, CustomEvent).
 *   - Sintaxis moderna que usan los módulos (?. y ??).
 *   - Cookies habilitadas (la sesión viaja en cookies).
 * Si falta algo, reemplaza la página por navegador-no-soportado.html, indicando qué falta y a dónde volver.
 * Quien decida continuar de todos modos desde el aviso no vuelve a ser redirigido en esa pestaña.
 */
(function () {
  'use strict';

  var PAGINA_AVISO = '/pages/navegador-no-soportado.html';
  var LLAVE_OMITIR = 'scrumflow:compatibilidadOmitida';

  // La propia página del aviso nunca se revisa, para no entrar en un ciclo
  if (window.location.pathname.indexOf('navegador-no-soportado') !== -1) return;

  /**
   * Indica si la persona ya eligió continuar con este navegador en esta pestaña.
   * @returns {boolean}
   */
  function omitioAviso() {
    try {
      return window.sessionStorage.getItem(LLAVE_OMITIR) === '1';
    } catch (error) {
      return false;
    }
  }

  /**
   * Indica si el navegador entiende ?. y ??. Si la política de seguridad (CSP) no permite evaluar código,
   * no se puede saber: se asume que sí para no bloquear a nadie por error.
   * @returns {boolean}
   */
  function soportaSintaxisModerna() {
    try {
      // eslint-disable-next-line no-new-func
      var prueba = new Function('var o = { a: { b: 1 } }; return (o?.a?.b ?? 0) === 1;');
      return prueba() === true;
    } catch (error) {
      return !(error instanceof SyntaxError);
    }
  }

  /**
   * Indica si el navegador admite variables CSS.
   * @returns {boolean}
   */
  function soportaVariablesCss() {
    return Boolean(window.CSS && typeof window.CSS.supports === 'function' && window.CSS.supports('--prueba', '0'));
  }

  /**
   * Lista lo que le falta al navegador; vacía si es compatible.
   * @returns {string[]}
   */
  function revisarCaracteristicas() {
    var faltan = [];
    var script = document.createElement('script');
    var elemento = window.Element && window.Element.prototype;

    if (!('noModule' in script)) faltan.push('modulos');
    if (typeof window.fetch !== 'function') faltan.push('fetch');
    if (typeof window.Promise !== 'function') faltan.push('promesas');
    if (!('WebSocket' in window)) faltan.push('websocket');
    if (!soportaVariablesCss()) faltan.push('css');
    if (!elemento || typeof elemento.closest !== 'function' || typeof elemento.replaceChildren !== 'function' ||
      typeof window.CustomEvent !== 'function') {
      faltan.push('dom');
    }
    if (!soportaSintaxisModerna()) faltan.push('sintaxis');
    if (navigator.cookieEnabled === false) faltan.push('cookies');
    return faltan;
  }

  if (omitioAviso()) return;

  var faltan = revisarCaracteristicas();
  if (faltan.length === 0) return;

  var volver = window.location.pathname + window.location.search;
  window.location.replace(
    PAGINA_AVISO + '?faltan=' + encodeURIComponent(faltan.join(',')) + '&volver=' + encodeURIComponent(volver)
  );
})();
