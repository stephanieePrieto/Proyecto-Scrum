/**
 * @file respaldo.service.js
 * @description Servicio de respaldos automáticos de PostgreSQL, retención y monitoreo de disponibilidad.
 * 
 * @author Stephanie Elizdeth Hernández Prieto
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { consulta } from '../config/db.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizProyecto = path.resolve(aqui, '..', '..');
const carpetaRespaldos = path.join(raizProyecto, 'backups');
const archivoDisponibilidad = path.join(carpetaRespaldos, 'disponibilidad-log.json');

let temporizadorRespaldo = null;
let temporizadorMonitor = null;

function asegurarCarpetaRespaldos() {
  if (!fs.existsSync(carpetaRespaldos)) {
    fs.mkdirSync(carpetaRespaldos, { recursive: true });
  }
}

async function obtenerTablasPublicas() {
  const res = await consulta(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename ASC
  `);
  return res.rows.map((r) => r.tablename);
}

/**
 * Detecta qué columnas de cada tabla son de tipo ARRAY nativo de PostgreSQL (ej. text[], int[]).
 */
async function obtenerMapaColumnasArray() {
  const res = await consulta(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'ARRAY'
  `);
  const mapa = new Map();
  for (const { table_name, column_name } of res.rows) {
    if (!mapa.has(table_name)) mapa.set(table_name, new Set());
    mapa.get(table_name).add(column_name);
  }
  return mapa;
}

/**
 * Convierte un arreglo JS al literal de array nativo de PostgreSQL: ['a', 'b'] -> '{"a","b"}'.
 */
function aLiteralArrayPostgres(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '{}';
  const elementos = arr.map((item) => {
    if (item === null || item === undefined) return 'NULL';
    if (typeof item === 'number' || typeof item === 'boolean') return String(item);
    const escapado = String(item).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escapado}"`;
  });
  return `{${elementos.join(',')}}`;
}

/**
 * Detecta tablas que tienen triggers de inmutabilidad o nombres de bitácora de auditoría.
 */
async function obtenerTablasInmutables() {
  const res = await consulta(`
    SELECT DISTINCT c.relname AS tabla
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND (
        t.tgname ILIKE '%inmutab%'
        OR t.tgname ILIKE '%auditoria%'
        OR c.relname ILIKE '%bitacora%'
      )
  `);
  return new Set(res.rows.map((r) => r.tabla));
}

/**
 * Ordena las tablas respetando dependencias de llaves foráneas (padres antes que hijas).
 */
async function ordenarTablasPorDependencias(tablas) {
  const resDeps = await consulta(`
    SELECT
      cls.relname AS tabla_hija,
      ref_cls.relname AS tabla_padre
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
  `);

  const setTablas = new Set(tablas);
  const padresDe = new Map(tablas.map((t) => [t, new Set()]));

  for (const { tabla_hija, tabla_padre } of resDeps.rows) {
    if (setTablas.has(tabla_hija) && setTablas.has(tabla_padre) && tabla_hija !== tabla_padre) {
      padresDe.get(tabla_hija).add(tabla_padre);
    }
  }

  const ordenadas = [];
  const visitadas = new Set();

  function visitar(tabla) {
    if (visitadas.has(tabla)) return;
    visitadas.add(tabla);
    for (const padre of padresDe.get(tabla) || []) {
      visitar(padre);
    }
    ordenadas.push(tabla);
  }

  for (const tabla of tablas) {
    visitar(tabla);
  }

  return ordenadas;
}

export async function generarRespaldoBaseDatos(etiqueta = 'manual') {
  asegurarCarpetaRespaldos();

  const marcaTiempo = new Date().toISOString().replace(/[:.]/g, '-');
  const nombreArchivo = `respaldo-${etiqueta}-${marcaTiempo}.json`;
  const rutaSalida = path.join(carpetaRespaldos, nombreArchivo);

  const tablas = await obtenerTablasPublicas();
  const datos = {};
  let totalRegistros = 0;

  for (const tabla of tablas) {
    const resTabla = await consulta(`SELECT * FROM public."${tabla}"`);
    datos[tabla] = resTabla.rows;
    totalRegistros += resTabla.rowCount ?? resTabla.rows.length;
  }

  const payload = {
    metadata: {
      proyecto: 'ScrumFlow',
      origen: etiqueta,
      fechaCreacion: new Date().toISOString(),
      totalTablas: tablas.length,
      totalRegistros,
    },
    tablas: datos,
  };

  fs.writeFileSync(rutaSalida, JSON.stringify(payload, null, 2), 'utf8');

  return {
    archivo: nombreArchivo,
    ruta: rutaSalida,
    totalTablas: tablas.length,
    totalRegistros,
    tamanoBytes: fs.statSync(rutaSalida).size,
  };
}

export function listarRespaldos() {
  asegurarCarpetaRespaldos();

  return fs
    .readdirSync(carpetaRespaldos)
    .filter((f) => f.startsWith('respaldo-') && f.endsWith('.json'))
    .map((archivo) => {
      const rutaCompleta = path.join(carpetaRespaldos, archivo);
      const stats = fs.statSync(rutaCompleta);
      return {
        archivo,
        ruta: rutaCompleta,
        tamanoBytes: stats.size,
        fechaCreacion: stats.birthtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
}

export function limpiarRespaldosAntiguos(conservarUltimos = 10) {
  const lista = listarRespaldos();
  const aEliminar = lista.slice(conservarUltimos);
  let eliminados = 0;

  for (const item of aEliminar) {
    fs.unlinkSync(item.ruta);
    eliminados += 1;
  }

  return { eliminados, conservados: Math.min(lista.length, conservarUltimos) };
}

export async function restaurarRespaldo(nombreOPathArchivo) {
  const rutaArchivo = path.isAbsolute(nombreOPathArchivo)
    ? nombreOPathArchivo
    : path.join(carpetaRespaldos, nombreOPathArchivo);

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error(`No se encontró el archivo de respaldo: ${rutaArchivo}`);
  }

  const contenido = JSON.parse(fs.readFileSync(rutaArchivo, 'utf8'));
  if (!contenido.tablas || typeof contenido.tablas !== 'object') {
    throw new Error('El formato del respaldo es inválido (falta el nodo "tablas").');
  }

  const tablasCrudas = Object.keys(contenido.tablas);
  if (tablasCrudas.length === 0) {
    return { tablasRestauradas: 0, registrosInsertados: 0, tablasInmutablesPreservadas: [] };
  }

  const tablasInmutables = await obtenerTablasInmutables();
  const mapaArrays = await obtenerMapaColumnasArray();
  const tablasOrdenadas = await ordenarTablasPorDependencias(tablasCrudas);
  let registrosInsertados = 0;

  await consulta('BEGIN');
  try {
    // 1. Limpiar solo tablas mutables en orden inverso (hijas -> padres)
    for (const tabla of [...tablasOrdenadas].reverse()) {
      if (tablasInmutables.has(tabla)) continue;
      await consulta(`DELETE FROM public."${tabla}"`);
    }

    // 2. Insertar en orden topológico (padres -> hijas)
    for (const tabla of tablasOrdenadas) {
      const filas = contenido.tablas[tabla] || [];
      const esInmutable = tablasInmutables.has(tabla);
      const colsArrayTabla = mapaArrays.get(tabla) || new Set();

      for (const fila of filas) {
        const columnas = Object.keys(fila);
        if (columnas.length === 0) continue;

        const colsSql = columnas.map((c) => `"${c}"`).join(', ');
        const paramsSql = columnas.map((_, idx) => `$${idx + 1}`).join(', ');
        const valores = columnas.map((c) => {
          const val = fila[c];
          if (val === null || val === undefined) return null;
          if (colsArrayTabla.has(c) && Array.isArray(val)) {
            return aLiteralArrayPostgres(val);
          }
          if (typeof val === 'object' && !(val instanceof Date)) {
            return JSON.stringify(val);
          }
          return val;
        });

        const sufijoConflicto = esInmutable ? ' ON CONFLICT DO NOTHING' : '';
        const resInsert = await consulta(
          `INSERT INTO public."${tabla}" (${colsSql}) OVERRIDING SYSTEM VALUE VALUES (${paramsSql})${sufijoConflicto}`,
          valores
        );
        registrosInsertados += resInsert.rowCount ?? 0;
      }

      // Sincronizar cualquier secuencia asociada a columnas de la tabla (id, usuario_id, etc.)
      await consulta(`
        DO $$
        DECLARE
          r RECORD;
        BEGIN
          FOR r IN
            SELECT
              a.attname AS columna,
              pg_get_serial_sequence(format('public.%I', c.relname), a.attname) AS seq_name
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = 'public'
              AND c.relname = '${tabla}'
              AND a.attnum > 0
              AND NOT a.attisdropped
          LOOP
            IF r.seq_name IS NOT NULL THEN
              EXECUTE format(
                'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM public.%I), 1), (SELECT COUNT(*) > 0 FROM public.%I))',
                r.seq_name, r.columna, '${tabla}', '${tabla}'
              );
            END IF;
          END LOOP;
        EXCEPTION
          WHEN insufficient_privilege THEN NULL;
        END $$;
      `);
    }

    await consulta('COMMIT');
  } catch (error) {
    await consulta('ROLLBACK');
    throw error;
  }

  return {
    tablasRestauradas: tablasOrdenadas.length,
    registrosInsertados,
    tablasInmutablesPreservadas: [...tablasInmutables].filter((t) => tablasCrudas.includes(t)),
  };
}

export async function registrarChequeoDisponibilidad() {
  asegurarCarpetaRespaldos();
  const inicio = Date.now();
  let disponible = false;

  try {
    await consulta('SELECT 1');
    disponible = true;
  } catch {
    disponible = false;
  }

  const latenciaMs = Date.now() - inicio;
  const ahora = new Date();
  const mesClave = `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`;

  let historial = {};
  if (fs.existsSync(archivoDisponibilidad)) {
    try {
      historial = JSON.parse(fs.readFileSync(archivoDisponibilidad, 'utf8'));
    } catch {
      historial = {};
    }
  }

  if (!historial[mesClave]) {
    historial[mesClave] = { totalChequeos: 0, exitosos: 0, fallidos: 0, ultimaVerificacion: null };
  }

  historial[mesClave].totalChequeos += 1;
  if (disponible) {
    historial[mesClave].exitosos += 1;
  } else {
    historial[mesClave].fallidos += 1;
  }
  historial[mesClave].ultimaVerificacion = ahora.toISOString();
  historial[mesClave].ultimaLatenciaMs = latenciaMs;

  fs.writeFileSync(archivoDisponibilidad, JSON.stringify(historial, null, 2), 'utf8');
  return { disponible, latenciaMs, mes: mesClave };
}

export function obtenerReporteDisponibilidadMensual(mesQuery) {
  asegurarCarpetaRespaldos();
  const ahora = new Date();
  const mes =
    mesQuery || `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`;

  let historial = {};
  if (fs.existsSync(archivoDisponibilidad)) {
    try {
      historial = JSON.parse(fs.readFileSync(archivoDisponibilidad, 'utf8'));
    } catch {
      historial = {};
    }
  }

  const datosMes = historial[mes] || {
    totalChequeos: 0,
    exitosos: 0,
    fallidos: 0,
    ultimaVerificacion: null,
    ultimaLatenciaMs: null,
  };

  const porcentajeDisponibilidad =
    datosMes.totalChequeos > 0
      ? Number(((datosMes.exitosos / datosMes.totalChequeos) * 100).toFixed(2))
      : 100;

  return {
    mes,
    porcentajeDisponibilidad,
    ...datosMes,
  };
}

export function iniciarPlanificadorRespaldosYMonitor() {
  if (temporizadorMonitor || temporizadorRespaldo) return;

  registrarChequeoDisponibilidad().catch((err) =>
    console.error('[Monitor Disponibilidad] Error en chequeo inicial:', err.message)
  );

  temporizadorMonitor = setInterval(() => {
    registrarChequeoDisponibilidad().catch((err) =>
      console.error('[Monitor Disponibilidad] Error:', err.message)
    );
  }, 5 * 60 * 1000);
  temporizadorMonitor.unref();

  temporizadorRespaldo = setInterval(async () => {
    try {
      const info = await generarRespaldoBaseDatos('programado');
      limpiarRespaldosAntiguos(10);
      console.log(`[Respaldo Automático] Generado ${info.archivo} (${info.totalRegistros} registros).`);
    } catch (err) {
      console.error('[Respaldo Automático] Error:', err.message);
    }
  }, 24 * 60 * 60 * 1000);
  temporizadorRespaldo.unref();
}

