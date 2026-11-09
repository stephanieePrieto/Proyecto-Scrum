// Responsable: Alfonso - HU-52: muestra qué le falta al navegador y permite volver a intentar o continuar (script clásico ES5)
/**
 * @file navegador-no-soportado.js
 * @description Completa la página de aviso con lo que detectó compatibilidad.js (parámetro "faltan") y prepara
 * los botones para volver a la página de origen (parámetro "volver"). Usa solo sintaxis ES5 porque se ejecuta
 * justo en navegadores antiguos.
 */
(function () {
  'use strict';

  var LLAVE_OMITIR = 'scrumflow:compatibilidadOmitida';

  /** Descripción de cada característica que revisa compatibilidad.js. */
  var DESCRIPCIONES = {
    modulos: 'Módulos de JavaScript (ES modules)',
    fetch: 'Peticiones al servidor con fetch',
    promesas: 'Promesas de JavaScript',
    websocket: 'WebSocket (actualizaciones en tiempo real)',
    css: 'Variables CSS',
    dom: 'Funciones modernas del DOM',
    sintaxis: 'Sintaxis moderna de JavaScript (?. y ??)',
    cookies: 'Cookies del sitio (mantienen tu sesión iniciada)'
  };

  /**
   * Lee un parámetro de la URL sin usar URLSearchParams (no existe en navegadores antiguos).
   * @param {string} nombre
   * @returns {string}
   */
  function leerParametro(nombre) {
    var partes = window.location.search.replace(/^\?/, '').split('&');
    for (var i = 0; i < partes.length; i++) {
      var par = partes[i].split('=');
      if (decodeURIComponent(par[0] || '') === nombre) {
        try {
          return decodeURIComponent((par[1] || '').replace(/\+/g, ' '));
        } catch (error) {
          return '';
        }
      }
    }
    return '';
  }

  /**
   * Solo se vuelve a rutas del propio sitio, para que el enlace no pueda llevar a otro dominio.
   * @param {string} ruta
   * @returns {string}
   */
  function rutaSegura(ruta) {
    var valida = ruta.charAt(0) === '/' && ruta.charAt(1) !== '/' && ruta.indexOf('\\') === -1 &&
      ruta.indexOf('navegador-no-soportado') === -1;
    return valida ? ruta : '/';
  }

  var faltan = leerParametro('faltan').split(',');
  var conocidas = [];
  for (var i = 0; i < faltan.length; i++) {
    if (DESCRIPCIONES.hasOwnProperty(faltan[i])) conocidas.push(faltan[i]);
  }
  var volver = rutaSegura(leerParametro('volver'));

  // Si lo único que falta son las cookies, el navegador sirve: se pide permitirlas
  if (conocidas.length === 1 && conocidas[0] === 'cookies') {
    document.getElementById('compat-titulo').textContent = 'Permite las cookies para usar ScrumFlow';
    document.getElementById('compat-texto').textContent =
      'Tu sesión se guarda en cookies de este mismo sitio. Permite las cookies de ScrumFlow ' +
      '(la protección contra rastreo puede seguir activa) y vuelve a intentar.';
    document.getElementById('compat-navegadores').style.display = 'none';
  }

  if (conocidas.length > 0) {
    var lista = document.getElementById('compat-faltan');
    for (var j = 0; j < conocidas.length; j++) {
      var elemento = document.createElement('li');
      elemento.appendChild(document.createTextNode(DESCRIPCIONES[conocidas[j]]));
      lista.appendChild(elemento);
    }
    document.getElementById('compat-detalle').removeAttribute('hidden');
  }

  var reintentar = document.getElementById('compat-reintentar');
  var continuar = document.getElementById('compat-continuar');
  reintentar.setAttribute('href', volver);
  continuar.setAttribute('href', volver);

  // "Continuar de todos modos" solo tiene sentido si el navegador puede guardar la elección en esta pestaña
  try {
    window.sessionStorage.setItem('scrumflow:prueba', '1');
    window.sessionStorage.removeItem('scrumflow:prueba');
    continuar.removeAttribute('hidden');
    continuar.onclick = function () {
      try {
        window.sessionStorage.setItem(LLAVE_OMITIR, '1');
      } catch (error) {
        /* Sin almacenamiento: el enlace lleva igual a la página, aunque el aviso puede volver a salir */
      }
    };
  } catch (error) {
    /* sessionStorage no disponible: se deja solo "Volver a intentar" */
  }
})();
