/**
 * @file logger.js
 * @description Utilidad centralizada de logging estructurado con sanitización de información sensible.
 * @author Stephanie Elizdeth Hernández Prieto
 */

// Claves que contienen información sensible y deben ocultarse
const CAMPOS_SENSIBLES = ['password', 'contrasena', 'clave', 'token', 'secret', 'tarjeta', 'cvv', 'authorization'];

/**
 * Recorre recursivamente un objeto o estructura y reemplaza valores sensibles por '[REDACTADO]'.
 * 
 * @param {*} datos - Datos a sanitizar (objeto, array o valor primitivo).
 * @returns {*} Objeto o estructura sanitizada.
 */
export function sanitizarDatos(datos) {
  if (datos === null || datos === undefined) return datos;

  if (typeof datos === 'string') {
    return datos;
  }

  if (Array.isArray(datos)) {
    return datos.map((item) => sanitizarDatos(item));
  }

  if (typeof datos === 'object') {
    const copiaSanitizada = {};
    for (const [clave, valor] of Object.entries(datos)) {
      if (CAMPOS_SENSIBLES.some((sensible) => clave.toLowerCase().includes(sensible))) {
        copiaSanitizada[clave] = '[REDACTADO]';
      } else if (typeof valor === 'object' && valor !== null) {
        copiaSanitizada[clave] = sanitizarDatos(valor);
      } else {
        copiaSanitizada[clave] = valor;
      }
    }
    return copiaSanitizada;
  }

  return datos;
}

/**
 * Formatea y emite un registro de log estructurado en formato JSON.
 * 
 * @param {'INFO'|'WARN'|'ERROR'} nivel - Nivel de severidad del log.
 * @param {string} mensaje - Descripción del evento.
 * @param {Object} [meta={}] - Metadatos adicionales a registrar.
 */
export function registrarLog(nivel, mensaje, meta = {}) {
  const logEstructurado = {
    timestamp: new Date().toISOString(),
    nivel,
    mensaje,
    metadatos: sanitizarDatos(meta),
  };

  const salidaStr = JSON.stringify(logEstructurado);

  if (nivel === 'ERROR') {
    console.error(salidaStr);
  } else if (nivel === 'WARN') {
    console.warn(salidaStr);
  } else {
    console.log(salidaStr);
  }
}