/**
 * @file apariencia.js
 * @description Aplica la apariencia y la accesibilidad elegidas por la persona antes de pintar la página.
 * Pone atributos en <html>: data-tema-efectivo (claro|oscuro), data-texto, data-contraste y
 * data-animaciones. Los estilos que dependen de ellos están en css/base.css.
 * Las preferencias se guardan en localStorage para que las páginas sin sesión (login, registro, etc.)
 * también las usen; layout.js y perfil.js las mantienen al día con la cuenta.
 * 
 * @author Citlaly Morales Viveros
 */
(function () {
    'use strict';

    var CLAVE = 'preferenciasApp';
    var POR_DEFECTO = { tema: 'sistema', textoGrande: false, altoContraste: false, reducirAnimaciones: false };
    var TEMAS = ['sistema', 'claro', 'oscuro'];
    var consultaOscuro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var actual = POR_DEFECTO;

    /**
     * Completa las preferencias con valores por defecto cuando falta algo o no es válido.
     * @param {*} valor
     * @returns {{tema: string, textoGrande: boolean, altoContraste: boolean, reducirAnimaciones: boolean}}
     */
    function normalizar(valor) {
        var datos = valor !== null && typeof valor === 'object' ? valor : {};
        return {
            tema: TEMAS.indexOf(datos.tema) !== -1 ? datos.tema : POR_DEFECTO.tema,
            textoGrande: typeof datos.textoGrande === 'boolean' ? datos.textoGrande : POR_DEFECTO.textoGrande,
            altoContraste: typeof datos.altoContraste === 'boolean' ? datos.altoContraste : POR_DEFECTO.altoContraste,
            reducirAnimaciones: typeof datos.reducirAnimaciones === 'boolean' ? datos.reducirAnimaciones : POR_DEFECTO.reducirAnimaciones
        };
    }

    /** @returns {Object} Preferencias guardadas en este navegador, o las por defecto. */
    function leerLocal() {
        try {
            return normalizar(JSON.parse(localStorage.getItem(CLAVE)));
        } catch (error) {
            return normalizar(null);
        }
    }

    /**
     * Guarda las preferencias en este navegador. Sin almacenamiento disponible, no pasa nada.
     * @param {Object} preferencias
     */
    function guardarLocal(preferencias) {
        try {
            localStorage.setItem(CLAVE, JSON.stringify(normalizar(preferencias)));
        } catch (error) { /* Sin almacenamiento: la preferencia solo dura la sesión de la página */ }
    }

    /**
     * Tema que se ve en realidad: "sistema" sigue la configuración del dispositivo.
     * @param {string} tema
     * @returns {string} "claro" u "oscuro".
     */
    function temaEfectivo(tema) {
        if (tema === 'claro' || tema === 'oscuro') return tema;
        return consultaOscuro && consultaOscuro.matches ? 'oscuro' : 'claro';
    }

    /**
     * Traduce las preferencias a atributos de <html>.
     * @param {Object} preferencias
     */
    function pintar(preferencias) {
        var html = document.documentElement;
        html.dataset.temaEfectivo = temaEfectivo(preferencias.tema);
        html.dataset.texto = preferencias.textoGrande ? 'grande' : 'normal';
        html.dataset.contraste = preferencias.altoContraste ? 'alto' : 'normal';
        html.dataset.animaciones = preferencias.reducirAnimaciones ? 'reducidas' : 'normal';
    }

    /**
     * Aplica unas preferencias en la página actual (no las guarda).
     * @param {Object} preferencias
     */
    function aplicar(preferencias) {
        actual = normalizar(preferencias);
        pintar(actual);
    }

    // Con "sistema", si el dispositivo cambia de tema mientras la página está abierta, se ajusta de inmediato.
    if (consultaOscuro && consultaOscuro.addEventListener) {
        consultaOscuro.addEventListener('change', function () { pintar(actual); });
    }

    aplicar(leerLocal());

    window.ScrumApariencia = {
        normalizar: normalizar,
        leerLocal: leerLocal,
        guardarLocal: guardarLocal,
        aplicar: aplicar,
        POR_DEFECTO: POR_DEFECTO
    };
})();