// Responsable: Alfonso - HU-27: reglas, SQL y avisos por socket (registro de horas reales)

/**
 * @file horas.service.js
 * @description Núcleo de la HU-27. Responsabilidades:
 *  1. Registrar, editar y eliminar horas reales por tarea (fecha, horas y nota).
 *  2. Reglas: horas > 0 con un decimal, máximo 24 h por persona y día, sin fechas futuras,
 *     sprint cerrado = solo lectura y un Developer solo registra en sus propias tareas.
 *  3. Temporizador persistente en el servidor (iniciar, pausar, reanudar, detener, descartar):
 *     una sola persona = un solo temporizador, y no se pierde si se cierra el navegador.
 *  4. Armar la hoja semanal de "Mis horas".
 *  5. Avisar por socket a la sala del proyecto (`horas:actualizadas`) para que tablero y métricas se refresquen.
 *
 * Las fechas viajan siempre como texto "AAAA-MM-DD" para evitar corrimientos por zona horaria.
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { enTransaccion } from '../detalle-tarjeta/detalle-tarjeta.service.js';
import { emitirAProyecto } from '../../sockets/emisor.js';

/*
 * Constantes
 */

/** Evento de socket que recibe la sala del proyecto cuando cambian las horas de una tarea. */
const EVENTO_HORAS = 'horas:actualizadas';

/** Máximo de horas por persona y día, en décimas de hora (24 h). */
const MAX_DECIMAS_DIA = 240;

/** Un segundo de temporizador = 1/3600 h; una décima de hora = 360 s. */
const SEGUNDOS_POR_DECIMA = 360;

const MAX_NOTA = 500;
const DIAS_LABORALES = 5;
const META_SEMANAL_POR_DEFECTO = 40;
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Roles que pueden registrar horas en cualquier tarea de su proyecto (matriz de permisos). */
const ROLES_SIN_RESTRICCION = new Set(['scrum_master', 'product_owner']);

/** Permite reutilizar las mismas funciones dentro y fuera de una transacción. */
const SIN_TRANSACCION = { query: (sql, parametros) => consulta(sql, parametros) };

/** Zona horaria de la persona (si la guardada no existe en PostgreSQL se usa UTC). */
const SQL_ZONA = `COALESCE((SELECT name FROM pg_timezone_names WHERE name = u.zona_horaria), 'UTC')`;

/** Temporizador de una persona con el tiempo transcurrido calculado por la base de datos. */
const SQL_TEMPORIZADOR = `
  SELECT tm.tarea_id, tm.estado,
         (tm.acumulado_segundos + CASE WHEN tm.estado = 'corriendo'
              THEN EXTRACT(EPOCH FROM (NOW() - tm.reanudado_en)) ELSE 0 END)::int AS transcurrido,
         t.titulo AS tarea_titulo,
         h.titulo AS historia_titulo,
         (tm.iniciado_en AT TIME ZONE ${SQL_ZONA})::date::text AS fecha_inicio,
         (NOW() AT TIME ZONE ${SQL_ZONA})::date::text AS hoy
    FROM temporizadores tm
    JOIN tareas t ON t.id = tm.tarea_id
    JOIN historias h ON h.id = t.historia_id
    JOIN usuarios u ON u.id = tm.usuario_id
   WHERE tm.usuario_id = $1`;

/*
 * Validaciones y utilidades
 */

/**
 * Convierte horas a décimas enteras para sumar sin errores de coma flotante.
 * @param {number|string} horas Horas (puede venir como texto desde PostgreSQL).
 * @returns {number} Décimas de hora.
 */
const aDecimas = (horas) => Math.round(Number(horas) * 10);

/**
 * Valida un identificador numérico positivo.
 * @param {*} valor Valor sin confiar.
 * @param {string} nombre Nombre para el mensaje de error.
 * @returns {number} Identificador válido.
 * @throws {ErrorApp} 400 si no es un entero positivo.
 */
function validarId(valor, nombre) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorApp(`El identificador de la ${nombre} no es válido.`, 400);
  return id;
}

/**
 * Valida una fecha "AAAA-MM-DD" que exista en el calendario.
 * @param {*} valor Valor sin confiar.
 * @returns {string} La misma fecha.
 * @throws {ErrorApp} 400 si el formato o la fecha no son válidos.
 */
function validarFecha(valor) {
  const fecha = typeof valor === 'string' ? valor : '';
  const real = new Date(`${fecha}T00:00:00Z`);
  if (!PATRON_FECHA.test(fecha) || Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== fecha) {
    throw new ErrorApp('La fecha no es válida.', 400);
  }
  return fecha;
}

/**
 * Valida las horas: mayores a cero, máximo 24 y un solo decimal.
 * @param {*} valor Número o texto numérico.
 * @returns {number} Horas válidas.
 * @throws {ErrorApp} 400 si no cumplen las reglas.
 */
function validarHoras(valor) {
  const horas = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (typeof horas !== 'number' || !Number.isFinite(horas)) throw new ErrorApp('Escribe las horas trabajadas.', 400);
  if (horas <= 0) throw new ErrorApp('Las horas deben ser mayores que cero.', 400);
  if (horas > 24) throw new ErrorApp('No se pueden registrar más de 24 horas en un día.', 400);
  if (Math.abs(horas * 10 - Math.round(horas * 10)) > 1e-9) {
    throw new ErrorApp('Usa máximo un decimal en las horas (por ejemplo 1.5).', 400);
  }
  return Math.round(horas * 10) / 10;
}

/**
 * Valida la nota opcional.
 * @param {*} valor Texto o vacío.
 * @returns {string|null} Nota limpia, o `null` si está vacía.
 * @throws {ErrorApp} 400 si no es texto o es demasiado larga.
 */
function validarNota(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ErrorApp('La nota no es válida.', 400);
  const nota = valor.trim();
  if (nota.length > MAX_NOTA) throw new ErrorApp(`La nota no puede superar ${MAX_NOTA} caracteres.`, 400);
  return nota || null;
}

/**
 * Suma días a una fecha "AAAA-MM-DD".
 * @param {string} fecha Fecha base.
 * @param {number} dias Días a sumar (puede ser negativo).
 * @returns {string} Nueva fecha.
 */
function sumarDias(fecha, dias) {
  const resultado = new Date(`${fecha}T00:00:00Z`);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado.toISOString().slice(0, 10);
}

/**
 * Devuelve el lunes de la semana de una fecha.
 * @param {string} fecha Fecha "AAAA-MM-DD".
 * @returns {string} Lunes de esa semana.
 */
function lunesDe(fecha) {
  const diaSemana = new Date(`${fecha}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return sumarDias(fecha, -((diaSemana + 6) % 7));
}

/**
 * Convierte una fila de `registros_horas` a la forma que consume el frontend.
 * @param {Object} fila Fila con fecha y horas como texto.
 * @returns {{id:number, tareaId:number, fecha:string, horas:number, nota:string|null}}
 */
function mapearRegistro(fila) {
  return {
    id: fila.id,
    tareaId: fila.tarea_id,
    fecha: fila.fecha,
    horas: Number(fila.horas),
    nota: fila.nota ?? null,
  };
}

/**
 * Convierte la fila del temporizador a la forma que consume el frontend.
 * @param {Object} fila Fila de `SQL_TEMPORIZADOR`.
 * @returns {Object} Temporizador con el tiempo ya calculado.
 */
function mapearTemporizador(fila) {
  const segundos = Number(fila.transcurrido);
  return {
    tareaId: fila.tarea_id,
    tareaTitulo: fila.tarea_titulo,
    historiaTitulo: fila.historia_titulo,
    estado: fila.estado,
    transcurridoSegundos: segundos,
    horasSugeridas: Math.round(segundos / SEGUNDOS_POR_DECIMA) / 10,
    fechaSugerida: fila.fecha_inicio,
    hoy: fila.hoy,
  };
}

/*
 * Reglas de negocio compartidas
 */

/**
 * Obtiene la fecha de hoy en la zona horaria de la persona.
 * @param {{query: Function}} cliente Conexión o transacción.
 * @param {number} usuarioId Persona.
 * @returns {Promise<string>} "AAAA-MM-DD".
 */
async function hoyDelUsuario(cliente, usuarioId) {
  const { rows } = await cliente.query(
    `SELECT (NOW() AT TIME ZONE ${SQL_ZONA})::date::text AS hoy FROM usuarios u WHERE u.id = $1`,
    [usuarioId],
  );
  return rows[0]?.hoy ?? new Date().toISOString().slice(0, 10);
}

/**
 * Carga una tarea con el estado de su sprint y el rol de la persona en su proyecto.
 * @param {{query: Function}} cliente Conexión o transacción.
 * @param {number} tareaId Tarea.
 * @param {number} usuarioId Persona que consulta.
 * @returns {Promise<Object|null>} Tarea, o `null` si no existe.
 */
async function cargarTarea(cliente, tareaId, usuarioId) {
  const { rows } = await cliente.query(
    `SELECT t.id, t.titulo, t.proyecto_id, t.responsable_id, s.estado AS sprint_estado, mp.rol
       FROM tareas t
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN miembros_proyecto mp ON mp.proyecto_id = t.proyecto_id AND mp.usuario_id = $2
      WHERE t.id = $1`,
    [tareaId, usuarioId],
  );
  return rows[0] ?? null;
}

/**
 * Un sprint cerrado solo se puede consultar.
 * @param {Object} tarea Tarea cargada.
 * @throws {ErrorApp} 409 si el sprint está cerrado.
 */
function exigirSprintAbierto(tarea) {
  if (tarea.sprint_estado === 'cerrado') {
    throw new ErrorApp('El sprint de esta tarea está cerrado: solo puedes consultar sus horas.', 409);
  }
}

/**
 * Comprueba que la persona puede registrar horas (o medir tiempo) en la tarea.
 * @param {Object|null} tarea Tarea cargada.
 * @param {number} usuarioId Persona.
 * @throws {ErrorApp} 404 si no existe o no es del proyecto; 403 si es una tarea ajena de un Developer; 409 si el sprint cerró.
 */
function exigirPuedeRegistrar(tarea, usuarioId) {
  if (!tarea || !tarea.rol) throw new ErrorApp('No se encontró la tarea.', 404);
  if (!ROLES_SIN_RESTRICCION.has(tarea.rol) && tarea.responsable_id !== usuarioId) {
    throw new ErrorApp('Solo puedes registrar horas en tus propias tareas.', 403);
  }
  exigirSprintAbierto(tarea);
}

/**
 * Valida el día de un registro: sin fechas futuras y sin pasar de 24 h por persona.
 * Bloquea el día de la persona hasta terminar la transacción para que dos registros
 * simultáneos no puedan rebasar el límite.
 * @param {{query: Function}} cliente Transacción.
 * @param {number} usuarioId Persona.
 * @param {string} fecha Día del registro.
 * @param {number} horas Horas que se quieren guardar.
 * @param {number|null} [excluirId] Registro que se está editando (no cuenta como ocupado).
 * @throws {ErrorApp} 400 si la fecha es futura o se superan las 24 h del día.
 */
async function validarDia(cliente, usuarioId, fecha, horas, excluirId = null) {
  if (fecha > await hoyDelUsuario(cliente, usuarioId)) {
    throw new ErrorApp('No puedes registrar horas en una fecha futura.', 400);
  }
  await cliente.query(
    "SELECT pg_advisory_xact_lock($1::int, ($2::date - DATE '1970-01-01'))",
    [usuarioId, fecha],
  );
  const { rows } = await cliente.query(
    `SELECT COALESCE(SUM(horas), 0)::text AS total
       FROM registros_horas
      WHERE usuario_id = $1 AND fecha = $2::date AND ($3::int IS NULL OR id <> $3)`,
    [usuarioId, fecha, excluirId],
  );
  const ocupadas = aDecimas(rows[0].total);
  if (ocupadas + aDecimas(horas) > MAX_DECIMAS_DIA) {
    const libres = (MAX_DECIMAS_DIA - ocupadas) / 10;
    throw new ErrorApp(
      libres > 0
        ? `Ese día ya tienes ${ocupadas / 10} h registradas; solo puedes agregar ${libres} h más (máximo 24 h por día).`
        : 'Ese día ya tienes 24 h registradas (el máximo por día).',
      400,
    );
  }
}

/**
 * Inserta un registro de horas ya validado.
 * @param {{query: Function}} cliente Transacción.
 * @param {{usuarioId:number, tareaId:number, fecha:string, horas:number, nota:string|null}} datos Registro.
 * @returns {Promise<Object>} Registro creado.
 */
async function insertarRegistro(cliente, { usuarioId, tareaId, fecha, horas, nota }) {
  await validarDia(cliente, usuarioId, fecha, horas);
  const { rows } = await cliente.query(
    `INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, tarea_id, fecha::text AS fecha, horas::text AS horas, nota`,
    [tareaId, usuarioId, fecha, horas, nota],
  );
  return mapearRegistro(rows[0]);
}

/**
 * Avisa a la sala del proyecto que cambiaron las horas de una tarea. Nunca lanza errores.
 * @param {number} proyectoId Proyecto de la tarea.
 * @param {number} tareaId Tarea.
 * @param {number} usuarioId Persona que cambió las horas.
 * @returns {Promise<number|null>} Total de horas reales de la tarea (todas las personas), o `null` si falló.
 */
async function publicarCambio(proyectoId, tareaId, usuarioId) {
  try {
    const { rows } = await consulta(
      'SELECT COALESCE(SUM(horas), 0)::text AS total FROM registros_horas WHERE tarea_id = $1',
      [tareaId],
    );
    const horasReales = Number(rows[0].total);
    emitirAProyecto(proyectoId, EVENTO_HORAS, { tareaId, usuarioId, horasReales });
    return horasReales;
  } catch (error) {
    console.error('[horas] No se pudo avisar el cambio de horas:', error?.message ?? error);
    return null;
  }
}

/*
 * Registros de horas
 */

/**
 * Registra horas reales de la persona en una tarea.
 * @param {number} usuarioId Persona que trabajó.
 * @param {{tareaId:number, fecha:string, horas:number, nota?:string}} datos Datos del formulario.
 * @returns {Promise<{registro:Object, horasRealesTarea:number|null}>}
 * @throws {ErrorApp} 400 datos inválidos; 403 tarea ajena; 404 tarea inexistente; 409 sprint cerrado.
 */
export async function registrarHoras(usuarioId, datos = {}) {
  const tareaId = validarId(datos.tareaId, 'tarea');
  const fecha = validarFecha(datos.fecha);
  const horas = validarHoras(datos.horas);
  const nota = validarNota(datos.nota);

  const { registro, proyectoId } = await enTransaccion(async (cliente) => {
    const tarea = await cargarTarea(cliente, tareaId, usuarioId);
    exigirPuedeRegistrar(tarea, usuarioId);
    const creado = await insertarRegistro(cliente, { usuarioId, tareaId, fecha, horas, nota });
    return { registro: creado, proyectoId: tarea.proyecto_id };
  });

  return { registro, horasRealesTarea: await publicarCambio(proyectoId, tareaId, usuarioId) };
}

/**
 * Edita un registro propio (fecha, horas y/o nota).
 * @param {number} usuarioId Dueño del registro.
 * @param {number|string} id Registro.
 * @param {{fecha?:string, horas?:number, nota?:string}} datos Campos a cambiar.
 * @returns {Promise<{registro:Object, horasRealesTarea:number|null}>}
 * @throws {ErrorApp} 400 datos inválidos; 404 registro ajeno o inexistente; 409 sprint cerrado.
 */
export async function actualizarRegistro(usuarioId, id, datos = {}) {
  const registroId = validarId(id, 'registro');
  const cambios = {};
  if (datos.fecha !== undefined) cambios.fecha = validarFecha(datos.fecha);
  if (datos.horas !== undefined) cambios.horas = validarHoras(datos.horas);
  if (datos.nota !== undefined) cambios.nota = validarNota(datos.nota);
  if (Object.keys(cambios).length === 0) throw new ErrorApp('No hay cambios que guardar.', 400);

  const { registro, proyectoId } = await enTransaccion(async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT id, tarea_id, fecha::text AS fecha, horas::text AS horas, nota
         FROM registros_horas WHERE id = $1 AND usuario_id = $2 FOR UPDATE`,
      [registroId, usuarioId],
    );
    if (!rows[0]) throw new ErrorApp('No se encontró el registro de horas.', 404);
    const actual = mapearRegistro(rows[0]);

    const tarea = await cargarTarea(cliente, actual.tareaId, usuarioId);
    exigirSprintAbierto(tarea);

    const nuevo = { ...actual, ...cambios };
    await validarDia(cliente, usuarioId, nuevo.fecha, nuevo.horas, registroId);
    const { rows: filas } = await cliente.query(
      `UPDATE registros_horas SET fecha = $2, horas = $3, nota = $4 WHERE id = $1
       RETURNING id, tarea_id, fecha::text AS fecha, horas::text AS horas, nota`,
      [registroId, nuevo.fecha, nuevo.horas, nuevo.nota],
    );
    return { registro: mapearRegistro(filas[0]), proyectoId: tarea.proyecto_id };
  });

  return { registro, horasRealesTarea: await publicarCambio(proyectoId, registro.tareaId, usuarioId) };
}

/**
 * Elimina un registro propio.
 * @param {number} usuarioId Dueño del registro.
 * @param {number|string} id Registro.
 * @returns {Promise<{id:number, horasRealesTarea:number|null}>}
 * @throws {ErrorApp} 404 registro ajeno o inexistente; 409 sprint cerrado.
 */
export async function eliminarRegistro(usuarioId, id) {
  const registroId = validarId(id, 'registro');

  const { tareaId, proyectoId } = await enTransaccion(async (cliente) => {
    const { rows } = await cliente.query(
      'SELECT tarea_id FROM registros_horas WHERE id = $1 AND usuario_id = $2 FOR UPDATE',
      [registroId, usuarioId],
    );
    if (!rows[0]) throw new ErrorApp('No se encontró el registro de horas.', 404);

    const tarea = await cargarTarea(cliente, rows[0].tarea_id, usuarioId);
    exigirSprintAbierto(tarea);
    await cliente.query('DELETE FROM registros_horas WHERE id = $1', [registroId]);
    return { tareaId: tarea.id, proyectoId: tarea.proyecto_id };
  });

  return { id: registroId, horasRealesTarea: await publicarCambio(proyectoId, tareaId, usuarioId) };
}

/*
 * Hoja semanal "Mis horas"
 */

/**
 * Arma la hoja de la semana: tareas de la persona (asignadas en un sprint abierto, no cerrado o con horas
 * registradas esa semana), horas por día, totales y meta semanal.
 * @param {number} usuarioId Persona.
 * @param {string} [inicio] Cualquier fecha de la semana deseada ("AAAA-MM-DD"); por defecto la semana actual.
 * @returns {Promise<Object>} Semana, meta, tareas con sus registros y totales.
 */
export async function obtenerSemana(usuarioId, inicio) {
  const hoy = await hoyDelUsuario(SIN_TRANSACCION, usuarioId);
  const lunes = lunesDe(inicio ? validarFecha(inicio) : hoy);
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));

  const [tareas, registros, capacidad] = await Promise.all([
    consulta(
      `SELECT t.id, t.titulo, t.responsable_id, t.proyecto_id, p.nombre AS proyecto,
              h.titulo AS historia, s.estado AS sprint_estado, mp.rol,
              t.horas_estimadas::text AS estimadas,
              (SELECT COALESCE(SUM(r.horas), 0)::text FROM registros_horas r WHERE r.tarea_id = t.id) AS reales
         FROM tareas t
         JOIN proyectos p ON p.id = t.proyecto_id
         JOIN historias h ON h.id = t.historia_id
         LEFT JOIN sprints s ON s.id = t.sprint_id
         LEFT JOIN miembros_proyecto mp ON mp.proyecto_id = t.proyecto_id AND mp.usuario_id = $1
        WHERE t.id IN (SELECT r.tarea_id FROM registros_horas r
                        WHERE r.usuario_id = $1 AND r.fecha BETWEEN $2::date AND $3::date)
         OR (t.responsable_id = $1 AND s.estado IS DISTINCT FROM 'cerrado')
        ORDER BY p.nombre, h.titulo, t.id`,
      [usuarioId, dias[0], dias[6]],
    ),
    consulta(
      `SELECT id, tarea_id, fecha::text AS fecha, horas::text AS horas, nota
         FROM registros_horas
        WHERE usuario_id = $1 AND fecha BETWEEN $2::date AND $3::date
        ORDER BY fecha, id`,
      [usuarioId, dias[0], dias[6]],
    ),
    consulta('SELECT horas_por_dia::text AS horas FROM capacidad_usuarios WHERE usuario_id = $1', [usuarioId]),
  ]);

  const filas = new Map(tareas.rows.map((t) => [t.id, {
    id: t.id,
    titulo: t.titulo,
    historia: t.historia,
    proyecto: t.proyecto,
    proyectoId: t.proyecto_id,
    horasEstimadas: t.estimadas === null ? null : Number(t.estimadas),
    horasRealesTotal: Number(t.reales),
    sprintCerrado: t.sprint_estado === 'cerrado',
    editable: t.sprint_estado !== 'cerrado'
      && Boolean(t.rol)
      && (ROLES_SIN_RESTRICCION.has(t.rol) || t.responsable_id === usuarioId),
    decimasPorDia: Array(7).fill(0),
    registros: [],
  }]));

  const totalesDia = Array(7).fill(0);
  for (const r of registros.rows) {
    const fila = filas.get(r.tarea_id);
    const indice = dias.indexOf(r.fecha);
    if (!fila || indice < 0) continue;
    fila.decimasPorDia[indice] += aDecimas(r.horas);
    fila.registros.push(mapearRegistro(r));
    totalesDia[indice] += aDecimas(r.horas);
  }

  const horasPorDia = capacidad.rows[0] ? Number(capacidad.rows[0].horas) : null;
  return {
    semana: { inicio: dias[0], fin: dias[6], hoy, dias },
    metaSemanal: horasPorDia === null ? META_SEMANAL_POR_DEFECTO : horasPorDia * DIAS_LABORALES,
    tareas: [...filas.values()].map(({ decimasPorDia, ...tarea }) => ({
      ...tarea,
      dias: decimasPorDia.map((d) => d / 10),
    })),
    totalesDia: totalesDia.map((d) => d / 10),
    totalSemana: totalesDia.reduce((suma, d) => suma + d, 0) / 10,
  };
}

/*
 * Temporizador
 */

/**
 * Devuelve el temporizador de la persona, si tiene uno.
 * @param {number} usuarioId Persona.
 * @returns {Promise<Object|null>} Temporizador con el tiempo transcurrido, o `null`.
 */
export async function obtenerTemporizador(usuarioId) {
  const { rows } = await consulta(SQL_TEMPORIZADOR, [usuarioId]);
  return rows[0] ? mapearTemporizador(rows[0]) : null;
}

/**
 * Devuelve el temporizador o falla si la persona no tiene ninguno.
 * @param {number} usuarioId Persona.
 * @returns {Promise<Object>} Temporizador.
 * @throws {ErrorApp} 404 si no hay temporizador.
 */
async function exigirTemporizador(usuarioId) {
  const temporizador = await obtenerTemporizador(usuarioId);
  if (!temporizador) throw new ErrorApp('No tienes un temporizador activo.', 404);
  return temporizador;
}

/**
 * Inicia el temporizador de la persona en una tarea. Solo se permite uno a la vez.
 * @param {number} usuarioId Persona.
 * @param {number|string} tareaId Tarea a medir.
 * @returns {Promise<Object>} Temporizador iniciado.
 * @throws {ErrorApp} 403/404/409 según las reglas de registro, o 409 si ya tiene un temporizador.
 */
export async function iniciarTemporizador(usuarioId, tareaId) {
  const id = validarId(tareaId, 'tarea');
  exigirPuedeRegistrar(await cargarTarea(SIN_TRANSACCION, id, usuarioId), usuarioId);

  const { rowCount } = await consulta(
    `INSERT INTO temporizadores (usuario_id, tarea_id, reanudado_en)
     VALUES ($1, $2, NOW()) ON CONFLICT (usuario_id) DO NOTHING`,
    [usuarioId, id],
  );
  if (rowCount === 0) {
    const actual = await obtenerTemporizador(usuarioId);
    throw new ErrorApp(
      `Ya tienes un temporizador activo en «${actual?.tareaTitulo ?? 'otra tarea'}». Deténlo o descártalo antes de iniciar otro.`,
      409,
    );
  }
  return exigirTemporizador(usuarioId);
}

/**
 * Pausa el temporizador (si ya estaba en pausa no pasa nada).
 * @param {number} usuarioId Persona.
 * @returns {Promise<Object>} Temporizador actualizado.
 * @throws {ErrorApp} 404 si no hay temporizador.
 */
export async function pausarTemporizador(usuarioId) {
  await consulta(
    `UPDATE temporizadores
        SET estado = 'pausado',
            acumulado_segundos = acumulado_segundos + EXTRACT(EPOCH FROM (NOW() - reanudado_en))::int,
            reanudado_en = NULL
      WHERE usuario_id = $1 AND estado = 'corriendo'`,
    [usuarioId],
  );
  return exigirTemporizador(usuarioId);
}

/**
 * Reanuda el temporizador (si ya estaba corriendo no pasa nada).
 * @param {number} usuarioId Persona.
 * @returns {Promise<Object>} Temporizador actualizado.
 * @throws {ErrorApp} 404 si no hay temporizador.
 */
export async function reanudarTemporizador(usuarioId) {
  await consulta(
    `UPDATE temporizadores SET estado = 'corriendo', reanudado_en = NOW()
      WHERE usuario_id = $1 AND estado = 'pausado'`,
    [usuarioId],
  );
  return exigirTemporizador(usuarioId);
}

/**
 * Detiene el temporizador y lo convierte en un registro de horas.
 * La persona puede confirmar menos horas de las medidas (nunca más), cambiar el día y agregar una nota.
 * Si algo falla (límite de 24 h, sprint cerrado…) el temporizador se conserva intacto.
 * @param {number} usuarioId Persona.
 * @param {{horas?:number, fecha?:string, nota?:string}} [datos] Confirmación opcional.
 * @returns {Promise<{registro:Object, horasRealesTarea:number|null}>}
 * @throws {ErrorApp} 400/403/404/409 según las reglas de registro.
 */
export async function detenerTemporizador(usuarioId, datos = {}) {
  const horasPedidas = datos.horas === undefined || datos.horas === null ? null : validarHoras(datos.horas);
  const fechaPedida = datos.fecha ? validarFecha(datos.fecha) : null;
  const nota = validarNota(datos.nota);

  const { registro, proyectoId } = await enTransaccion(async (cliente) => {
    const { rows } = await cliente.query(`${SQL_TEMPORIZADOR} FOR UPDATE OF tm`, [usuarioId]);
    if (!rows[0]) throw new ErrorApp('No tienes un temporizador activo.', 404);
    const temporizador = mapearTemporizador(rows[0]);

    const tarea = await cargarTarea(cliente, temporizador.tareaId, usuarioId);
    exigirPuedeRegistrar(tarea, usuarioId);

    const horas = horasPedidas ?? temporizador.horasSugeridas;
    const maximo = Math.ceil(temporizador.transcurridoSegundos / SEGUNDOS_POR_DECIMA) / 10;
    if (horas <= 0) {
      throw new ErrorApp('El temporizador lleva menos de 3 minutos: sigue midiendo o descártalo.', 400);
    }
    if (horas > maximo + 1e-9) {
      throw new ErrorApp(`El temporizador midió ${maximo} h: no puedes registrar más tiempo del medido.`, 400);
    }

    const creado = await insertarRegistro(cliente, {
      usuarioId,
      tareaId: temporizador.tareaId,
      fecha: fechaPedida ?? temporizador.fechaSugerida,
      horas,
      nota,
    });
    await cliente.query('DELETE FROM temporizadores WHERE usuario_id = $1', [usuarioId]);
    return { registro: creado, proyectoId: tarea.proyecto_id };
  });

  return { registro, horasRealesTarea: await publicarCambio(proyectoId, registro.tareaId, usuarioId) };
}

/**
 * Descarta el temporizador sin registrar nada.
 * @param {number} usuarioId Persona.
 * @returns {Promise<{descartado:boolean}>}
 */
export async function descartarTemporizador(usuarioId) {
  const { rowCount } = await consulta('DELETE FROM temporizadores WHERE usuario_id = $1', [usuarioId]);
  return { descartado: rowCount > 0 };
}