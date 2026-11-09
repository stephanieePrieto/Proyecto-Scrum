// Responsable: Alfonso - HU-52: pruebas de las reglas puras de tiempo real y sondeo
/**
 * @file tiempo-real.reglas.test.js
 * @description Suite de pruebas unitarias de la lógica pura de la HU-52 (criterio 5: WebSocket bloqueado,
 * sondeo cada 5 s y aviso de tiempo real limitado). Compatible con Jest y ES Modules. Sin DOM ni red.
 */

import { describe, test, expect } from '@jest/globals';
import {
  INTERVALO_SONDEO_MS,
  FALLOS_PARA_LIMITAR,
  ARRASTRE_INACTIVO_MS,
  REINTENTO_RECHAZO_MIN_MS,
  REINTENTO_RECHAZO_MAX_MS,
  MODOS,
  EVENTOS,
  estadoInicial,
  registrarEventoConexion,
  esperaTrasRechazo,
  accionesDeTransicion,
  arrastreVigente,
  decidirCicloSondeo,
  huboCambios,
} from './tiempo-real.reglas.js';

/** Aplica varios eventos seguidos desde el estado inicial. */
function aplicar(...eventos) {
  return eventos.reduce((estado, evento) => registrarEventoConexion(estado, evento), estadoInicial());
}

const TABLERO = {
  columnas: [{ id: 1, nombre: 'Por hacer', orden: 1 }, { id: 2, nombre: 'Hecho', orden: 2 }],
  tareas: [
    { id: 10, version: 1, columna_id: 1, orden: 1, titulo: 'Login', responsable_id: 3, etiquetas: ['frontend'] },
    { id: 11, version: 4, columna_id: 2, orden: 1, titulo: 'API', responsable_id: null, etiquetas: [] },
  ],
};

describe('HU-52 · Reglas de tiempo real limitado', () => {
  test('los valores del criterio: sondeo cada 5 s y bloqueo tras 2 fallos seguidos', () => {
    expect(INTERVALO_SONDEO_MS).toBe(5000);
    expect(FALLOS_PARA_LIMITAR).toBe(2);
    expect(estadoInicial()).toEqual({ modo: MODOS.CONECTANDO, fallosSeguidos: 0 });
  });

  test('flujo ideal: al conectar el WebSocket se pasa a tiempo real', () => {
    expect(aplicar(EVENTOS.CONECTADO)).toEqual({ modo: MODOS.TIEMPO_REAL, fallosSeguidos: 0 });
  });

  test('un solo fallo no basta; dos fallos seguidos se consideran WebSocket bloqueado', () => {
    expect(aplicar(EVENTOS.ERROR).modo).toBe(MODOS.CONECTANDO);
    expect(aplicar(EVENTOS.ERROR, EVENTOS.ERROR)).toEqual({ modo: MODOS.LIMITADO, fallosSeguidos: 2 });
    expect(aplicar(EVENTOS.ERROR, EVENTOS.CONECTADO, EVENTOS.ERROR).modo).toBe(MODOS.CONECTANDO);
  });

  test('si el cliente de Socket.io no se pudo cargar, se limita de inmediato', () => {
    expect(aplicar(EVENTOS.SIN_CLIENTE).modo).toBe(MODOS.LIMITADO);
  });

  test('un corte breve después de estar en tiempo real no limita; si la reconexión falla dos veces, sí', () => {
    const cortado = aplicar(EVENTOS.CONECTADO, EVENTOS.DESCONECTADO);
    expect(cortado.modo).toBe(MODOS.CONECTANDO);
    expect(registrarEventoConexion(registrarEventoConexion(cortado, EVENTOS.ERROR), EVENTOS.ERROR).modo).toBe(MODOS.LIMITADO);
  });

  test('estados o eventos inválidos no rompen la máquina de estados', () => {
    expect(registrarEventoConexion(null, EVENTOS.ERROR)).toEqual({ modo: MODOS.CONECTANDO, fallosSeguidos: 1 });
    expect(registrarEventoConexion({ modo: 'otro', fallosSeguidos: -3 }, 'evento-raro')).toEqual(estadoInicial());
    const limitado = aplicar(EVENTOS.ERROR, EVENTOS.ERROR);
    expect(registrarEventoConexion(limitado, 'evento-raro')).toEqual(limitado);
    expect(limitado).toEqual({ modo: MODOS.LIMITADO, fallosSeguidos: 2 });
  });

  test('si el servidor rechaza la conexión (sesión vencida) se reintenta a los 2 s, duplicando la espera hasta 30 s', () => {
    expect(esperaTrasRechazo(1)).toBe(REINTENTO_RECHAZO_MIN_MS);
    expect(esperaTrasRechazo(2)).toBe(4000);
    expect(esperaTrasRechazo(3)).toBe(8000);
    expect(esperaTrasRechazo(10)).toBe(REINTENTO_RECHAZO_MAX_MS);
    expect(esperaTrasRechazo(0)).toBe(REINTENTO_RECHAZO_MIN_MS);
    expect(esperaTrasRechazo('x')).toBe(REINTENTO_RECHAZO_MIN_MS);
  });

  test('al entrar a "limitado" se inicia el sondeo y se avisa; al recuperar el tiempo real se detiene y se sincroniza una vez', () => {
    const conectando = estadoInicial();
    const limitado = aplicar(EVENTOS.ERROR, EVENTOS.ERROR);
    const recuperado = registrarEventoConexion(limitado, EVENTOS.CONECTADO);

    expect(accionesDeTransicion(conectando, limitado)).toEqual({
      iniciarSondeo: true, detenerSondeo: false, mostrarAviso: true, ocultarAviso: false, sincronizarUnaVez: false,
    });
    expect(accionesDeTransicion(limitado, recuperado)).toEqual({
      iniciarSondeo: false, detenerSondeo: true, mostrarAviso: false, ocultarAviso: true, sincronizarUnaVez: true,
    });
    // Seguir limitado tras otro fallo no repite el aviso ni reinicia el sondeo
    expect(Object.values(accionesDeTransicion(limitado, registrarEventoConexion(limitado, EVENTOS.ERROR))).some(Boolean)).toBe(false);
  });

  test('el sondeo solo corre en modo limitado y se salta durante un arrastre, un modal, la pestaña oculta o una petición pendiente', () => {
    expect(decidirCicloSondeo({ modo: MODOS.LIMITADO })).toEqual({ ejecutar: true, motivo: null });
    expect(decidirCicloSondeo({ modo: MODOS.TIEMPO_REAL }).motivo).toBe('modo');
    expect(decidirCicloSondeo({ modo: MODOS.LIMITADO, arrastrando: true }).motivo).toBe('arrastre');
    expect(decidirCicloSondeo({ modo: MODOS.LIMITADO, modalAbierto: true }).motivo).toBe('modal');
    expect(decidirCicloSondeo({ modo: MODOS.LIMITADO, pestanaOculta: true }).motivo).toBe('pestana_oculta');
    expect(decidirCicloSondeo({ modo: MODOS.LIMITADO, peticionEnCurso: true }).motivo).toBe('peticion_en_curso');
    expect(decidirCicloSondeo().ejecutar).toBe(false);
  });

  test('criterio 2: un arrastre sigue vivo mientras llegan eventos y se da por terminado si dejan de llegar (giro de tablet)', () => {
    expect(arrastreVigente({ activo: true, ultimoEvento: 1000, ahora: 1000 + ARRASTRE_INACTIVO_MS - 1 })).toBe(true);
    expect(arrastreVigente({ activo: true, ultimoEvento: 1000, ahora: 1000 + ARRASTRE_INACTIVO_MS })).toBe(false);
    expect(arrastreVigente({ activo: false, ultimoEvento: 1000, ahora: 1000 })).toBe(false);
    expect(arrastreVigente({ activo: true })).toBe(true);
    expect(arrastreVigente()).toBe(false);
  });

  test('huboCambios ignora el orden de llegada y detecta cambios de columna, versión, título o columnas del tablero', () => {
    const mismoEnOtroOrden = { columnas: [...TABLERO.columnas].reverse(), tareas: [...TABLERO.tareas].reverse() };
    expect(huboCambios(TABLERO, mismoEnOtroOrden)).toBe(false);

    const movida = { ...TABLERO, tareas: [{ ...TABLERO.tareas[0], columna_id: 2, version: 2 }, TABLERO.tareas[1]] };
    expect(huboCambios(TABLERO, movida)).toBe(true);

    const renombrada = { ...TABLERO, tareas: [{ ...TABLERO.tareas[0], titulo: 'Login seguro' }, TABLERO.tareas[1]] };
    expect(huboCambios(TABLERO, renombrada)).toBe(true);

    const columnaNueva = { ...TABLERO, columnas: [...TABLERO.columnas, { id: 3, nombre: 'Revisión', orden: 3 }] };
    expect(huboCambios(TABLERO, columnaNueva)).toBe(true);

    expect(huboCambios(undefined, { columnas: null, tareas: 'x' })).toBe(false);
  });
});
