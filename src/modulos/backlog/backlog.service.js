// Responsable: Jetz - HU-02, HU-03, HU-05: reglas, SQL y avisos por socket (historias, orden de prioridad y puntos)
/**
 * HU-02 · CRUD de historias de usuario  |  HU-03 · Priorizar el backlog arrastrando.
 *
 * Tablas que usa (database/schema.sql): historias, epicas, sprints, usuarios, proyectos,
 * miembros_equipo y miembros_proyecto. Los puntos (HU-05) ya se validan aquí con la escala Fibonacci.
 *
 * Decisiones importantes:
 *  - La PRIORIDAD de una historia es su posición (`orden`), no un campo aparte (HU-03).
 *  - Todo cambio de orden o alta pasa por un candado de PostgreSQL por proyecto
 *    (pg_advisory_xact_lock). Así, si dos personas reordenan a la vez, el servidor las atiende
 *    en el orden en que llegan y todos terminan con el MISMO orden, sin posiciones duplicadas.
 *  - Editar usa control de versión (columna `version`): si alguien guardó antes, responde 409.
 */
import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto } from '../../sockets/emisor.js';

// ---------- Constantes ----------

/** Escala permitida para los puntos de historia (HU-05). */
export const ESCALA_FIBONACCI = [1, 2, 3, 5, 8, 13, 21];

/**
 * Nombres de los eventos en tiempo real.
 * [AJUSTAR] src/sockets/eventos.js (BASE) está vacío; cuando Stephy lo llene, importar de ahí.
 */
export const EVENTOS = {
  creada: 'story:created',
  actualizada: 'story:updated',
  eliminada: 'story:deleted',
  reordenada: 'story:reordered',
};

/** Clase del candado de PostgreSQL: evita chocar con candados de otros módulos. */
const CANDADO_BACKLOG = 1001;

// ---------- Utilidades internas ----------

/**
 * Lanzar un ErrorApp. `detalles` viaja al navegador (ver backlog.controller.js)
 * para pintar errores en línea o reconocer casos como "sprint activo".
 */
function lanzar(estado, mensaje, detalles) {
  const error = new ErrorApp(mensaje, estado);
  if (detalles) error.detalles = detalles;
  throw error;
}

/** Convertir el parámetro de la URL en un id entero positivo (o null). */
function aId(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Comprobar que el usuario puede ver el proyecto: es admin, es del equipo o es miembro del proyecto.
 * Si no, responde 404 para no revelar que el proyecto existe (HU-43).
 *
 * @returns {Promise<{id:number, archivado:boolean}>}
 */
async function exigirAcceso(usuario, proyectoId) {
  const id = aId(proyectoId);
  if (!id) lanzar(404, 'Proyecto no encontrado.');
  const { rows } = await consulta(
    `SELECT p.id, p.archivado,
            ($2::boolean
              OR EXISTS (SELECT 1 FROM miembros_equipo me WHERE me.equipo_id = p.equipo_id AND me.usuario_id = $3)
              OR EXISTS (SELECT 1 FROM miembros_proyecto mp WHERE mp.proyecto_id = p.id AND mp.usuario_id = $3)
            ) AS tiene_acceso
       FROM proyectos p WHERE p.id = $1`,
    [id, usuario?.es_admin === true, usuario?.id ?? 0],
  );
  if (!rows[0] || !rows[0].tiene_acceso) lanzar(404, 'Proyecto no encontrado.');
  return rows[0];
}

/**
 * Comprobar que el usuario puede MODIFICAR el backlog (crear, editar, eliminar, reordenar).
 *
 * [AJUSTAR HU-42] Por ahora puede modificar cualquiera que tenga acceso al proyecto.
 * Cuando Citlaly termine requiereRol/permisos, aquí (y solo aquí) se añade la regla:
 *   - Product Owner y Admin: pueden todo.
 *   - Developer: solo proponer (crear con `propuesta = true`) o comentar; reordenar => 403.
 */
async function exigirPermisoEscritura(usuario, proyectoId) {
  const proyecto = await exigirAcceso(usuario, proyectoId);
  if (proyecto.archivado) lanzar(409, 'El proyecto está archivado; su backlog ya no se puede modificar.');
  return proyecto;
}

// Columnas y JOINs que se devuelven siempre, para que todas las respuestas tengan la misma forma
const COLUMNAS = `h.id, h.numero_hu, h.proyecto_id, h.epica_id, e.nombre AS epica_nombre, e.color AS epica_color,
  h.sprint_id, s.nombre AS sprint_nombre, s.estado AS sprint_estado,
  h.titulo, h.como, h.quiero, h.para, h.criterios, h.puntos, h.etiquetas,
  h.estado, h.orden, h.propuesta, h.version, h.creada_por, u.nombre AS creada_por_nombre, h.creado_en`;
const DESDE = `FROM historias h
  LEFT JOIN epicas e ON e.id = h.epica_id
  LEFT JOIN sprints s ON s.id = h.sprint_id
  LEFT JOIN usuarios u ON u.id = h.creada_por`;

/** Leer una historia por id (con épica, sprint y autor). */
async function buscarHistoria(id) {
  const { rows } = await consulta(`SELECT ${COLUMNAS} ${DESDE} WHERE h.id = $1`, [id]);
  return rows[0] ?? null;
}

/** Lista priorizada del Product Backlog: las historias que aún no están terminadas. */
async function consultarLista(proyectoId) {
  const { rows } = await consulta(
    `SELECT ${COLUMNAS} ${DESDE}
      WHERE h.proyecto_id = $1 AND h.estado IN ('backlog', 'en_sprint')
      ORDER BY h.orden, h.id`,
    [proyectoId],
  );
  return rows;
}

/**
 * Validar y limpiar los datos del formulario de historia.
 * Lanza 400 con { campos: { campo: mensaje } } para que el formulario marque cada error en línea.
 */
function validarDatos(datos = {}) {
  const campos = {};
  const texto = (valor) => String(valor ?? '').trim() || null;

  const titulo = String(datos.titulo ?? '').trim();
  if (!titulo) campos.titulo = 'Escribe el título de la historia.';
  else if (titulo.length > 200) campos.titulo = 'El título no puede superar 200 caracteres.';

  const como = texto(datos.como);
  const quiero = texto(datos.quiero);
  const para = texto(datos.para);
  const criterios = texto(datos.criterios);

  if (!como) campos.como = 'El campo Como es obligatorio.';
  if (!quiero) campos.quiero = 'El campo Quiero es obligatorio.';
  if (!para) campos.para = 'El campo Para es obligatorio.';
  
  if (como && como.length > 300) campos.como = 'Máximo 300 caracteres.';
  if (quiero && quiero.length > 500) campos.quiero = 'Máximo 500 caracteres.';
  if (para && para.length > 500) campos.para = 'Máximo 500 caracteres.';
  if (criterios && criterios.length > 4000) campos.criterios = 'Máximo 4000 caracteres.';

  // Puntos: vacío = sin estimar; si hay valor debe pertenecer a la escala Fibonacci
  let puntos = null;
  if (datos.puntos !== null && datos.puntos !== undefined && datos.puntos !== '') {
    puntos = Number(datos.puntos);
    if (!ESCALA_FIBONACCI.includes(puntos)) campos.puntos = 'Los puntos deben ser 1, 2, 3, 5, 8, 13 o 21.';
  }

  // Etiquetas: acepta un arreglo o texto separado por comas; quita vacías y repetidas
  const bruto = Array.isArray(datos.etiquetas) ? datos.etiquetas : String(datos.etiquetas ?? '').split(',');
  const etiquetas = [...new Set(bruto.map((e) => String(e).trim()).filter(Boolean))];
  if (etiquetas.length > 10) campos.etiquetas = 'Usa máximo 10 etiquetas.';
  else if (etiquetas.some((e) => e.length > 30)) campos.etiquetas = 'Cada etiqueta puede tener hasta 30 caracteres.';

  let epicaId = null;
  if (datos.epica_id !== null && datos.epica_id !== undefined && datos.epica_id !== '') {
    epicaId = aId(datos.epica_id);
    if (!epicaId) campos.epica_id = 'Elige una épica válida.';
  }

  if (Object.keys(campos).length) lanzar(400, 'Revisa los campos marcados.', { campos });
  return { titulo, como, quiero, para, criterios, puntos, etiquetas, epicaId };
}

/** La épica elegida debe pertenecer al mismo proyecto. */
async function validarEpica(proyectoId, epicaId) {
  if (!epicaId) return;
  const { rows } = await consulta('SELECT 1 FROM epicas WHERE id = $1 AND proyecto_id = $2', [epicaId, proyectoId]);
  if (!rows[0]) lanzar(400, 'Revisa los campos marcados.', { campos: { epica_id: 'La épica no pertenece a este proyecto.' } });
}

/** Ejecutar `trabajo(cliente)` dentro de una transacción con el candado del proyecto. */
async function conCandadoDeProyecto(proyectoId, trabajo) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    // Serializa altas y reordenamientos del mismo proyecto: se atienden por orden de llegada
    await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [CANDADO_BACKLOG, proyectoId]);
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

// ---------- Casos de uso ----------

/** Listar el backlog de un proyecto, con las épicas disponibles para el formulario. */
export async function listar(usuario, proyectoId) {
  const proyecto = await exigirAcceso(usuario, proyectoId);
  const historias = await consultarLista(proyecto.id);
  const { rows: epicas } = await consulta(
    'SELECT id, nombre, color FROM epicas WHERE proyecto_id = $1 ORDER BY nombre', [proyecto.id],
  );
  return { historias, epicas };
}

/** HU-02: crear una historia al FINAL del backlog y avisar a los usuarios conectados. */
export async function crear(usuario, proyectoId, datos) {
  const proyecto = await exigirPermisoEscritura(usuario, proyectoId);
  const d = validarDatos(datos);
  await validarEpica(proyecto.id, d.epicaId);

  const id = await conCandadoDeProyecto(proyecto.id, async (cliente) => {
    const { rows: [{ siguiente }] } = await cliente.query(
      'SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM historias WHERE proyecto_id = $1', [proyecto.id],
    );

  const { rows: [{ siguiente_hu }] } = await cliente.query(
    `SELECT COALESCE(
      (
        SELECT MIN(candidato)
        FROM generate_series(
          1,
          (SELECT COALESCE(MAX(numero_hu), 0) + 1
            FROM historias
            WHERE proyecto_id = $1)
        ) AS candidato
        WHERE NOT EXISTS (
          SELECT 1
          FROM historias h
          WHERE h.proyecto_id = $1
            AND h.numero_hu = candidato
        )
      ),
      1
    )::int AS siguiente_hu`,
    [proyecto.id],
  );

  
  const { rows: [{ id: nuevoId }] } = await cliente.query(
    `INSERT INTO historias (
      proyecto_id, epica_id, titulo, como, quiero, para,
      criterios, puntos, etiquetas, orden, numero_hu,
      propuesta, creada_por
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13
    )
    RETURNING id`,
    [
      proyecto.id,
      d.epicaId,
      d.titulo,
      d.como,
      d.quiero,
      d.para,
      d.criterios,
      d.puntos,
      d.etiquetas,
      siguiente,
      siguiente_hu,
      false,
      usuario.id,
    ],
  );

  return nuevoId;
});

const historia = await buscarHistoria(id);
  emitirAProyecto(proyecto.id, EVENTOS.creada, { historia });
  return historia;
}

/** HU-02: editar una historia. Exige la `version` que el usuario vio al abrir el formulario. */
export async function actualizar(usuario, historiaId, datos = {}) {
  const id = aId(historiaId);
  const actual = id ? await buscarHistoria(id) : null;
  if (!actual) lanzar(404, 'La historia no existe o ya fue eliminada.');
  await exigirPermisoEscritura(usuario, actual.proyecto_id);

  const d = validarDatos(datos);
  await validarEpica(actual.proyecto_id, d.epicaId);
  const version = aId(datos.version);
  if (!version) lanzar(400, 'Falta la versión de la historia. Recarga la página e inténtalo de nuevo.');

  const { rowCount } = await consulta(
    `UPDATE historias
        SET epica_id = $1, titulo = $2, como = $3, quiero = $4, para = $5, criterios = $6,
            puntos = $7, etiquetas = $8, version = version + 1
      WHERE id = $9 AND version = $10`,
    [d.epicaId, d.titulo, d.como, d.quiero, d.para, d.criterios, d.puntos, d.etiquetas, id, version],
  );
  if (!rowCount) {
    lanzar(409, 'Otra persona modificó esta historia mientras la editabas. Revisa los cambios y vuelve a guardar.', { codigo: 'version' });
  }

  const historia = await buscarHistoria(id);
  emitirAProyecto(actual.proyecto_id, EVENTOS.actualizada, { historia });
  return historia;
}

/**
 * HU-02: eliminar una historia.
 * Si pertenece a un sprint ACTIVO se bloquea con 409 + codigo 'sprint_activo'; la pantalla
 * entonces ofrece "Devolver al backlog" (ver devolverAlBacklog).
 */
export async function eliminar(usuario, historiaId) {
  const id = aId(historiaId);
  const historia = id ? await buscarHistoria(id) : null;
  if (!historia) lanzar(404, 'La historia no existe o ya fue eliminada.');
  await exigirPermisoEscritura(usuario, historia.proyecto_id);

  if (historia.sprint_id && historia.sprint_estado === 'activo') {
    lanzar(
      409,
      `La historia pertenece al sprint activo «${historia.sprint_nombre}». Devuélvela al backlog antes de eliminarla.`,
      { codigo: 'sprint_activo', sprint: historia.sprint_nombre },
    );
  }

  // Nota: sus tareas se borran en cascada (ON DELETE CASCADE de tareas.historia_id)
  await consulta('DELETE FROM historias WHERE id = $1', [id]);
  emitirAProyecto(historia.proyecto_id, EVENTOS.eliminada, { id, proyecto_id: historia.proyecto_id });
  return { id };
}

/**
 * HU-02: sacar una historia de su sprint y devolverla al backlog.
 * [CONFIRMAR con Camila/HU-08] También se quitan sus tareas del tablero (sprint_id y columna_id = NULL)
 * para que no queden tarjetas sueltas de una historia que ya no está en el sprint.
 */
export async function devolverAlBacklog(usuario, historiaId) {
  const id = aId(historiaId);
  const historia = id ? await buscarHistoria(id) : null;
  if (!historia) lanzar(404, 'La historia no existe o ya fue eliminada.');
  await exigirPermisoEscritura(usuario, historia.proyecto_id);
  if (!historia.sprint_id) lanzar(409, 'La historia ya está en el backlog.');

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(
      `UPDATE historias SET sprint_id = NULL, estado = 'backlog', version = version + 1 WHERE id = $1`, [id],
    );
    await cliente.query('UPDATE tareas SET sprint_id = NULL, columna_id = NULL WHERE historia_id = $1', [id]);
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }

  const actualizada = await buscarHistoria(id);
  emitirAProyecto(historia.proyecto_id, EVENTOS.actualizada, { historia: actualizada });
  return actualizada;
}

/**
 * HU-03: mover una historia a otra posición y guardar la nueva prioridad.
 *
 * El cliente manda `historia_id` y `antes_de_id` (la historia ANTES de la cual quedará;
 * null = al final). Se usa un vecino y no un número de posición porque, si otra persona movió
 * cosas mientras tanto, el vecino sigue siendo una referencia válida.
 * Después se renumeran TODAS las historias del proyecto (1..n): nunca hay posiciones repetidas.
 */
export async function reordenar(usuario, proyectoId, { historia_id: historiaId, antes_de_id: antesDeId } = {}) {
  const proyecto = await exigirPermisoEscritura(usuario, proyectoId);
  const mover = aId(historiaId);
  const antes = antesDeId === null || antesDeId === undefined ? null : aId(antesDeId);
  if (!mover || (antesDeId !== null && antesDeId !== undefined && !antes)) {
    lanzar(400, 'Indica qué historia mover y dónde colocarla.');
  }

  const orden = await conCandadoDeProyecto(proyecto.id, async (cliente) => {
    const { rows } = await cliente.query(
      'SELECT id FROM historias WHERE proyecto_id = $1 ORDER BY orden, id', [proyecto.id],
    );
    let ids = rows.map((fila) => fila.id);
    if (!ids.includes(mover)) lanzar(404, 'La historia ya no existe en este backlog.');
    if (antes !== null && !ids.includes(antes)) {
      lanzar(409, 'La lista cambió mientras la reordenabas. Se cargó el orden actual.', { codigo: 'lista_cambio' });
    }

    ids = ids.filter((id) => id !== mover);
    const posicion = antes === null ? ids.length : ids.indexOf(antes);
    ids.splice(posicion, 0, mover);

    // Un solo UPDATE: la posición en el arreglo (1..n) pasa a ser la nueva prioridad
    await cliente.query(
      `UPDATE historias h SET orden = t.n::int
         FROM unnest($1::int[]) WITH ORDINALITY AS t(id, n)
        WHERE h.id = t.id AND h.proyecto_id = $2 AND h.orden IS DISTINCT FROM t.n::int`,
      [ids, proyecto.id],
    );
    return ids;
  });

  emitirAProyecto(proyecto.id, EVENTOS.reordenada, { proyecto_id: proyecto.id, orden, historia_id: mover, por: usuario.id });
  return { historias: await consultarLista(proyecto.id) };
}
