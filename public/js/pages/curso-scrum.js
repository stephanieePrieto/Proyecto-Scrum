/**
 * @file curso-scrum.js
 * @description Gestión de Drawer Retráctil, Ruta Lineal de lecciones, Guía Práctica de ScrumFlow, Roles y Quizzes renderizados inline.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { montarBarraSuperior } from '../core/layout.js';
import { mensajeError } from '../core/errores.js';

let lecciones = [];
let quizzes = [];
let quizFinalData = null;
let proyectoId = null;
let rolEnProyecto = null;
let filtroGuia = 'todas';
let tutorialActivo = new URLSearchParams(location.search).get('tutorial') === '1';

// Estado de navegación actual
let vistaActiva = tutorialActivo || new URLSearchParams(location.search).get('vista') === 'guia-app'
  ? 'guia-app'
  : 'modulos'; // 'modulos' | 'guia-app' | 'roles' | 'quiz-final'
let leccionActivaId = null;
let modoLeccion = 'lectura'; // 'lectura' | 'quiz'
let ultimoResultadoQuiz = null; // { aprobado, calificacion, mensaje }

async function inicializar() {
  montarBarraSuperior();

  const proyectoGuardado = localStorage.getItem('proyectoActivo');
  if (!proyectoGuardado || proyectoGuardado === 'null' || proyectoGuardado === 'undefined') {
    mostrarAvisoSeleccionarProyecto();
    return;
  }

  proyectoId = parseInt(proyectoGuardado, 10);
  await cargarCurso();
  configurarEventos();
  if (vistaActiva !== 'modulos') cambiarVista(vistaActiva);
}

function mostrarAvisoSeleccionarProyecto() {
  const contenedorPrincipal = document.querySelector('main.curso-contenedor') || document.querySelector('main');
  if (contenedorPrincipal) {
    contenedorPrincipal.innerHTML = `
      <div class="aviso aviso--vacio" style="text-align: center; padding: 50px 20px; background: var(--blanco, #ffffff); border-radius: 12px; border: 1px solid var(--borde, #e2e8f0); max-width: 650px; margin: 40px auto; box-shadow: var(--sombra-sm, 0 1px 3px rgba(0,0,0,0.05));">
        <div class="aviso__icono" style="font-size: 3.5rem; color: var(--ambar-500, #d97706); margin-bottom: 20px;">
          <i class="fas fa-folder-open"></i>
        </div>
        <h2 class="aviso__titulo" style="margin-bottom: 12px; font-size: 1.5rem; color: var(--primario, #1e293b); font-weight: 600;">
          Selecciona un proyecto
        </h2>
        <p class="aviso__texto" style="color: var(--texto-suave, #64748b); margin-bottom: 25px; font-size: 1rem; line-height: 1.5;">
          Para ingresar a la Capacitación de Scrum y validar los permisos de tu rol en el equipo, primero debes seleccionar un proyecto activo en el Dashboard.
        </p>
        <a class="boton boton--primario" href="./dashboard.html" style="display: inline-flex; align-items: center; gap: 8px;">
          <i class="fas fa-arrow-left"></i> Ir al Dashboard
        </a>
      </div>
    `;
  }
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

function obtenerTokenCsrf() {
  const match = document.cookie.match(/(?:^|; )\s*csrfToken\s*=\s*([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  const metaCsrf = document.querySelector('meta[name="csrf-token"]');
  return metaCsrf ? metaCsrf.getAttribute('content') : '';
}

/**
 * Adaptar la guía práctica al rol vigente en el proyecto seleccionado.
 *
 * @param {string|null} rol Rol Scrum asignado dentro del proyecto.
 * @returns {void}
 */
function aplicarGuiaPorRol(rol) {
  const resumenPorRol = {
    scrum_master: 'Tu recorrido como Scrum Master se enfoca en facilitar el flujo, hacer visibles los impedimentos y acompañar las ceremonias del equipo.',
    product_owner: 'Tu recorrido como Product Owner se enfoca en priorizar el valor, preparar el backlog y validar los resultados del Sprint.',
    developer: 'Tu recorrido como Developer se enfoca en planificar el trabajo, actualizar las tarjetas, registrar horas y colaborar con el equipo.',
  };
  const etiquetasPorRol = {
    scrum_master: 'Scrum Master',
    product_owner: 'Product Owner',
    developer: 'Developer',
  };
  const rolActual = Object.hasOwn(resumenPorRol, rol) ? rol : null;
  const titulo = document.getElementById('guia-titulo');
  const resumen = document.getElementById('guia-rol-resumen');
  const textoTitulo = titulo?.querySelector('span');
  if (textoTitulo) {
    textoTitulo.textContent = rolActual
      ? `Guía práctica para ${etiquetasPorRol[rolActual]}`
      : 'Guía práctica de ScrumFlow';
  }
  if (resumen) {
    resumen.textContent = resumenPorRol[rolActual] ||
      'Consulta las funciones principales de ScrumFlow y los permisos disponibles en tu proyecto.';
  }
  aplicarFiltrosGuia();
}

/**
 * Aplicar a las tarjetas de la guía tanto el filtro elegido como el rol del proyecto.
 *
 * @returns {void}
 */
function aplicarFiltrosGuia() {
  const grid = document.getElementById('guia-pantallas-grid');
  if (!grid) return;

  const tarjetas = [...grid.querySelectorAll('.guia-card')];
  tarjetas.forEach((card) => {
    const roles = (card.dataset.roles || '').split(',').filter(Boolean);
    const coincideRol = !rolEnProyecto || !roles.length || roles.includes(rolEnProyecto);
    const coincideCategoria = filtroGuia === 'todas' || card.dataset.categoria === filtroGuia;
    card.hidden = !coincideRol || !coincideCategoria;
    card.classList.toggle('oculta', card.hidden);
  });

  const tarjetaRol = tarjetas.find((card) => {
    const roles = (card.dataset.roles || '').split(',').filter(Boolean);
    return roles.length === 1 && roles[0] === rolEnProyecto;
  });
  if (tarjetaRol) grid.prepend(tarjetaRol);
}

/**
 * Guardar que la persona terminó o decidió omitir el recorrido guiado.
 *
 * @param {'completado'|'omitido'} estado Resultado del recorrido.
 * @returns {Promise<void>}
 */
async function registrarEstadoGuia(estado) {
  const aviso = document.getElementById('estado-guia');
  const botones = [
    document.getElementById('btn-omitir-guia'),
    document.getElementById('btn-finalizar-guia'),
  ].filter(Boolean);
  botones.forEach((boton) => { boton.disabled = true; });
  if (aviso) aviso.textContent = 'Guardando tu progreso…';

  try {
    const respuesta = await fetch('/api/curso-scrum/tutorial/completar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': obtenerTokenCsrf(),
      },
      body: JSON.stringify({ proyectoId, estado }),
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      throw new Error(datos.mensaje || 'No se pudo guardar el progreso. Inténtalo de nuevo.');
    }

    if (aviso) {
      aviso.textContent = estado === 'omitido'
        ? 'Guía omitida. Tu elección quedó guardada.'
        : 'Recorrido completado. Tu progreso quedó guardado.';
    }
    if (tutorialActivo) window.location.href = '/pages/dashboard.html';
  } catch (error) {
    if (aviso) aviso.textContent = error.message || 'No se pudo guardar el progreso. Inténtalo de nuevo.';
    botones.forEach((boton) => { boton.disabled = false; });
  }
}

async function cargarCurso() {
  try {
    const respuesta = await fetch(`/api/curso-scrum/${proyectoId}`);
    if (!respuesta.ok) throw new Error('Error al cargar el curso');

    const datos = await respuesta.json();
    lecciones = datos.lecciones || [];
    quizzes = datos.quizzes || [];
    quizFinalData = datos.quizFinal || null;
    rolEnProyecto = datos.rolEnProyecto;
    aplicarGuiaPorRol(rolEnProyecto);

    // Mostrar botón "Avance del Equipo" solo a SM o PO
    const btnAvance = document.getElementById('btn-avance-equipo');
    if (btnAvance) {
      btnAvance.style.display = (datos.rolEnProyecto === 'scrum_master' || datos.rolEnProyecto === 'product_owner') ? 'inline-flex' : 'none';
    }

    // Seleccionar la primera lección pendiente o la primera disponible si aún no hay ninguna activa
    if (!leccionActivaId && lecciones.length > 0) {
      const primeraPendiente = lecciones.find(l => !l.completada);
      leccionActivaId = primeraPendiente ? primeraPendiente.id : lecciones[0].id;
    }

    actualizarBarraProgreso(datos.porcentajeAvance);
    actualizarBadgeQuizFinal();
    verificarCertificado(datos.certificado?.tieneCertificado);
    renderizarSidebarRuta();
    renderizarVistaActual();
  } catch (error) {
    console.error('[curso-scrum] Error:', error);
    const aviso = document.getElementById('estado-guia');
    if (aviso) aviso.textContent = 'No se pudo cargar la guía. Revisa tu conexión y vuelve a intentarlo.';
  }
}

function actualizarBarraProgreso(porcentaje) {
  const barra = document.getElementById('barra-progreso');
  const texto = document.getElementById('porcentaje-avance');
  if (barra) barra.style.width = `${porcentaje}%`;
  if (texto) texto.textContent = `${porcentaje}%`;
}

function actualizarBadgeQuizFinal() {
  const badge = document.getElementById('badge-estado-quiz-final');
  if (!badge || !quizFinalData) return;

  if (quizFinalData.aprobado) {
    badge.textContent = 'Aprobado';
    badge.classList.add('aprobado');
  } else if (quizFinalData.calificacion > 0) {
    badge.textContent = `${quizFinalData.calificacion}%`;
  }
}

function verificarCertificado(tieneCertificado) {
  const alerta = document.getElementById('certificado-alerta');
  if (tieneCertificado && alerta) alerta.classList.add('visible');
}

/* ===========================================================================
   RENDERIZADO DEL SIDEBAR (BLOQUE 2: RUTA LINEAL / TIMELINE)
   ========================================================================== */
function renderizarSidebarRuta() {
  const contenedorRuta = document.getElementById('sidebar-ruta-lecciones');
  if (!contenedorRuta) return;

  // Agrupar por sección conservando el orden
  const secciones = {};
  lecciones.forEach(leccion => {
    const nombreSeccion = leccion.seccion || 'Módulos';
    if (!secciones[nombreSeccion]) secciones[nombreSeccion] = [];
    secciones[nombreSeccion].push(leccion);
  });

  let html = '';
  for (const [seccion, lista] of Object.entries(secciones)) {
    html += `<div class="ruta-seccion-label">${seccion}</div>`;
    html += lista.map(leccion => {
      const esActiva = vistaActiva === 'modulos' && leccion.id === leccionActivaId;
      const tieneQuiz = quizzes.some(q => q.leccion_id === leccion.id);

      return `
        <button type="button" class="ruta-item ${esActiva ? 'activa' : ''} ${leccion.completada ? 'completada' : ''}" data-leccion-id="${leccion.id}">
          <span class="ruta-nodo">
            ${leccion.completada ? '<i class="fas fa-check"></i>' : leccion.orden}
          </span>
          <div class="ruta-info">
            <span class="ruta-titulo">${leccion.titulo}</span>
            <div class="ruta-meta">
              <span>${leccion.completada ? 'Completada' : 'Lectura'}</span>
              ${tieneQuiz ? `
                <span class="ruta-quiz-tag ${leccion.quiz_aprobado ? 'aprobado' : ''}">
                  <i class="fas ${leccion.quiz_aprobado ? 'fa-star' : 'fa-question-circle'}"></i>
                  ${leccion.quiz_aprobado ? 'Quiz OK' : 'Quiz'}
                </span>
              ` : ''}
            </div>
          </div>
        </button>
      `;
    }).join('');
  }

  contenedorRuta.innerHTML = html;
}

/* ===========================================================================
   CONTROL DE VISTAS DEL PANEL PRINCIPAL
   ========================================================================== */
function cambiarVista(nuevaVista) {
  vistaActiva = nuevaVista;
  ultimoResultadoQuiz = null;

  // Actualizar estado activo en Bloque 1 del Sidebar
  document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
    btn.classList.toggle('activa', btn.dataset.vista === nuevaVista);
  });

  // Mostrar el panel correspondiente
  document.querySelectorAll('.vista-panel').forEach(panel => {
    panel.classList.toggle('activa', panel.id === `vista-${nuevaVista}`);
  });

  renderizarSidebarRuta();
  renderizarVistaActual();
  cerrarSidebarMovil();
}

function renderizarVistaActual() {
  if (vistaActiva === 'modulos') {
    if (modoLeccion === 'quiz') {
      renderizarQuizLeccionInline(leccionActivaId);
    } else {
      renderizarLeccionInline(leccionActivaId);
    }
  } else if (vistaActiva === 'quiz-final') {
    renderizarPortadaQuizFinal();
  }
}

/* ===========================================================================
   VISTA 1: LECTURA ENFOCADA Y QUIZ MODULAR INLINE
   ========================================================================== */
function renderizarLeccionInline(id) {
  const visor = document.getElementById('visor-leccion');
  if (!visor) return;

  const indice = lecciones.findIndex(l => l.id === id);
  const leccion = lecciones[indice];
  if (!leccion) {
    visor.innerHTML = '<p>No hay lecciones disponibles.</p>';
    return;
  }

  const anterior = indice > 0 ? lecciones[indice - 1] : null;
  const siguiente = indice < lecciones.length - 1 ? lecciones[indice + 1] : null;
  const tieneQuiz = quizzes.some(q => q.leccion_id === leccion.id);

  visor.innerHTML = `
    <div class="leccion-top-bar">
      <span class="leccion-breadcrumb">${leccion.seccion || 'Módulo'} · Lección ${leccion.orden} de ${lecciones.length}</span>
      <div class="leccion-badges">
        <span class="estado-pill ${leccion.completada ? 'estado-pill--completada' : 'estado-pill--pendiente'}">
          <i class="fas ${leccion.completada ? 'fa-check-circle' : 'fa-clock'}"></i>
          ${leccion.completada ? 'Completada' : 'Pendiente'}
        </span>
        ${tieneQuiz ? `
          <span class="estado-pill ${leccion.quiz_aprobado ? 'estado-pill--quiz-ok' : 'estado-pill--pendiente'}">
            <i class="fas ${leccion.quiz_aprobado ? 'fa-star' : 'fa-clipboard-check'}"></i>
            ${leccion.quiz_aprobado ? 'Quiz Aprobado' : 'Quiz Pendiente'}
          </span>
        ` : ''}
      </div>
    </div>

    <h2 class="visor-leccion-titulo">${leccion.orden}. ${leccion.titulo}</h2>

    <div class="visor-leccion-cuerpo">
      ${decodeHtmlEntities(leccion.contenido)}
    </div>

    <div class="visor-leccion-footer">
      <div>
        ${anterior ? `
          <button type="button" class="boton boton--secundario" id="btn-leccion-anterior" data-id="${anterior.id}">
            <i class="fas fa-arrow-left"></i> Anterior
          </button>
        ` : ''}
      </div>

      <div class="visor-leccion-footer__derecha">
        ${tieneQuiz ? `
          <button type="button" class="boton boton--secundario" id="btn-abrir-quiz-inline" data-id="${leccion.id}">
            <i class="fas fa-tasks"></i> ${leccion.quiz_aprobado ? 'Reintentar Quiz' : 'Evaluar Lección (Quiz)'}
          </button>
        ` : ''}

        <button type="button" class="boton boton--primario" id="btn-completar-continuar" data-id="${leccion.id}" data-siguiente-id="${siguiente ? siguiente.id : ''}">
          <i class="fas fa-check"></i> ${siguiente ? 'Completar y Continuar' : 'Completar Lección'}
        </button>
      </div>
    </div>
  `;
}

function renderizarQuizLeccionInline(id) {
  const visor = document.getElementById('visor-leccion');
  const leccion = lecciones.find(l => l.id === id);
  if (!visor || !leccion) return;

  const quizzesLeccion = quizzes.filter(q => q.leccion_id === id);

  let bannerHtml = '';
  if (ultimoResultadoQuiz) {
    bannerHtml = `
      <div class="quiz-resultado-banner ${ultimoResultadoQuiz.aprobado ? 'aprobado' : 'reprobado'}">
        <div>
          <strong>${ultimoResultadoQuiz.aprobado ? '¡Excelente trabajo!' : 'Sigue practicando'}</strong>
          <div>${ultimoResultadoQuiz.mensaje}</div>
        </div>
        <button type="button" class="boton boton--secundario" id="btn-volver-lectura">
          <i class="fas fa-book-open"></i> Volver a la lección
        </button>
      </div>
    `;
  }

  let preguntasHtml = quizzesLeccion.map((quiz, index) => {
    let opcionesObj = quiz.opciones;
    if (typeof opcionesObj === 'string') {
      try { opcionesObj = JSON.parse(opcionesObj); } catch (e) { }
    }
    return `
      <div class="quiz-bloque-pregunta">
        <div class="quiz-pregunta">${index + 1}. ${quiz.pregunta}</div>
        <div class="quiz-opciones" data-quiz-id="${quiz.id}">
          ${Object.entries(opcionesObj).map(([key, valor]) => `
            <div class="quiz-opcion" data-opcion="${key}" data-quiz-id="${quiz.id}">
              ${String.fromCharCode(65 + parseInt(key, 10))}. ${valor}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  visor.innerHTML = `
    <div class="quiz-inline-header">
      <div>
        <span class="leccion-breadcrumb">Evaluación del Módulo</span>
        <h2>Quiz: ${leccion.titulo}</h2>
      </div>
      <button type="button" class="boton boton--secundario" id="btn-volver-lectura">
        <i class="fas fa-arrow-left"></i> Volver a la Lectura
      </button>
    </div>

    ${bannerHtml}
    ${preguntasHtml}

    <div class="visor-leccion-footer">
      <button type="button" class="boton boton--primario" id="btn-enviar-quiz-inline" data-leccion-id="${id}">
        <i class="fas fa-paper-plane"></i> Enviar Respuestas
      </button>
    </div>
  `;

  activarOpcionesQuiz();
}

/* ===========================================================================
   VISTA 4: QUIZ FINAL INTEGRADOR (PORTADA Y PREGUNTAS INLINE)
   ========================================================================== */
function renderizarPortadaQuizFinal() {
  const contenedor = document.getElementById('contenedor-quiz-final');
  if (!contenedor) return;

  const califActual = quizFinalData?.calificacion || 0;
  const aprobado = quizFinalData?.aprobado || false;

  contenedor.innerHTML = `
    <div class="quiz-final-portada">
      <i class="fas fa-award icono-quiz-final"></i>
      <h2>Evaluación Final de Certificación</h2>
      <p style="color: var(--texto-suave);">Demuestra tus conocimientos integrales sobre la metodología Scrum en ScrumFlow.</p>

      <div class="requisitos-quiz-final">
        <div class="requisito-item">
          <i class="fas fa-check-circle" style="color: var(--esmeralda-500);"></i>
          <span><strong>Requisito de Aprobación:</strong> Puntuación mínima de <strong>9.5 / 10 (95%)</strong>.</span>
        </div>
        <div class="requisito-item">
          <i class="fas fa-list-ol" style="color: var(--primario);"></i>
          <span><strong>Formato:</strong> 20 preguntas integradoras de los 4 módulos.</span>
        </div>
        <div class="requisito-item">
          <i class="fas fa-redo" style="color: var(--ambar-500);"></i>
          <span><strong>Intentos:</strong> Ilimitados (se conserva tu calificación más alta).</span>
        </div>
        ${califActual > 0 ? `
          <div class="requisito-item">
            <i class="fas fa-chart-bar" style="color: ${aprobado ? 'var(--esmeralda-500)' : 'var(--primario)'};"></i>
            <span><strong>Tu mejor calificación registrada:</strong> ${califActual}% ${aprobado ? '(Certificado desbloqueado)' : ''}</span>
          </div>
        ` : ''}
      </div>

      <button id="btn-iniciar-quiz-final" type="button" class="boton boton--primario boton--lg">
        <i class="fas fa-play-circle"></i> ${califActual > 0 ? 'Reintentar Quiz Final Integrador' : 'Iniciar Quiz Final Integrador'}
      </button>
    </div>
  `;
}

function renderizarPreguntasQuizFinalInline() {
  const contenedor = document.getElementById('contenedor-quiz-final');
  if (!contenedor || !quizFinalData?.preguntas) return;

  let bannerHtml = '';
  if (ultimoResultadoQuiz) {
    bannerHtml = `
      <div class="quiz-resultado-banner ${ultimoResultadoQuiz.aprobado ? 'aprobado' : 'reprobado'}">
        <div>
          <strong>${ultimoResultadoQuiz.aprobado ? '¡Certificación Aprobada!' : 'Calificación insuficiente'}</strong>
          <div>${ultimoResultadoQuiz.mensaje}</div>
        </div>
        <button type="button" class="boton boton--secundario" id="btn-cancelar-quiz-final">
          Ver resumen
        </button>
      </div>
    `;
  }

  const preguntasHtml = quizFinalData.preguntas.map((quiz, index) => {
    let opcionesObj = quiz.opciones;
    if (typeof opcionesObj === 'string') {
      try { opcionesObj = JSON.parse(opcionesObj); } catch (e) { }
    }
    return `
      <div class="quiz-bloque-pregunta">
        <div class="quiz-pregunta">${index + 1}. ${quiz.pregunta}</div>
        <div class="quiz-opciones" data-quiz-id="${quiz.id}">
          ${Object.entries(opcionesObj).map(([key, valor]) => `
            <div class="quiz-opcion" data-opcion="${key}" data-quiz-id="${quiz.id}">
              ${String.fromCharCode(65 + parseInt(key, 10))}. ${valor}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  contenedor.innerHTML = `
    <div class="quiz-inline-header">
      <div>
        <span class="leccion-breadcrumb">Certificación Oficial ScrumFlow</span>
        <h2>Quiz Final Integrador (20 Preguntas)</h2>
      </div>
      <button type="button" class="boton boton--secundario" id="btn-cancelar-quiz-final">
        <i class="fas fa-times"></i> Salir del Quiz
      </button>
    </div>

    <div class="aviso avisos--info" style="margin-bottom: 20px;">
      Responde las 20 preguntas. Necesitas al menos <strong>95% (19 de 20 aciertos)</strong> para obtener tu certificado en PDF.
    </div>

    ${bannerHtml}
    ${preguntasHtml}

    <div class="visor-leccion-footer">
      <button type="button" class="boton boton--primario boton--lg" id="btn-enviar-quiz-final-inline">
        <i class="fas fa-paper-plane"></i> Finalizar y Calificar Examen
      </button>
    </div>
  `;

  activarOpcionesQuiz();
  contenedor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function activarOpcionesQuiz() {
  document.querySelectorAll('.quiz-opcion').forEach(opcion => {
    opcion.addEventListener('click', () => {
      const quizId = opcion.dataset.quizId;
      document.querySelectorAll(`.quiz-opcion[data-quiz-id="${quizId}"]`).forEach(o => o.classList.remove('seleccionada'));
      opcion.classList.add('seleccionada');
    });
  });
}

/* ===========================================================================
   ACCIONES DE PROGRESO Y ENVÍO DE QUIZZES
   ========================================================================== */
async function completarLeccionYContinuar(leccionId, siguienteId) {
  try {
    await fetch('/api/curso-scrum/progreso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': obtenerTokenCsrf() },
      body: JSON.stringify({
        leccionId,
        completada: true,
        posicionScroll: Math.round(window.scrollY)
      })
    });

    if (siguienteId) {
      leccionActivaId = parseInt(siguienteId, 10);
      modoLeccion = 'lectura';
    }

    await cargarCurso();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    console.error('[curso-scrum] Error al completar lección:', error);
    alert(mensajeError(error, 'No se pudo guardar el progreso de la lección. Inténtalo de nuevo.'));
  }
}

async function enviarQuizInline(leccionId) {
  const opcionesSeleccionadas = {};
  const seleccionadas = document.querySelectorAll('#visor-leccion .quiz-opcion.seleccionada');
  const quizzesLeccion = quizzes.filter(q => q.leccion_id === leccionId);

  if (seleccionadas.length !== quizzesLeccion.length) {
    alert(`Has respondido ${seleccionadas.length} de ${quizzesLeccion.length} preguntas. Por favor respóndelas todas.`);
    return;
  }

  seleccionadas.forEach(op => {
    opcionesSeleccionadas[parseInt(op.dataset.quizId, 10)] = parseInt(op.dataset.opcion, 10);
  });

  try {
    const respuesta = await fetch('/api/curso-scrum/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': obtenerTokenCsrf() },
      body: JSON.stringify({ leccionId, respuestas: opcionesSeleccionadas })
    });
    const datos = await respuesta.json();

    ultimoResultadoQuiz = {
      aprobado: datos.aprobado,
      calificacion: datos.calificacion,
      mensaje: datos.aprobado
        ? `Calificación obtenida: ${datos.calificacion}%. ¡Quiz aprobado!`
        : `Calificación obtenida: ${datos.calificacion}%. Necesitas 100% para aprobar este módulo.`
    };

    await cargarCurso();
    document.getElementById('visor-leccion')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    alert(mensajeError(error, 'No se pudieron enviar las respuestas del quiz. Revisa tu conexión e inténtalo de nuevo.'));
  }
}

async function enviarQuizFinalInline() {
  const opcionesSeleccionadas = {};
  const seleccionadas = document.querySelectorAll('#contenedor-quiz-final .quiz-opcion.seleccionada');

  if (seleccionadas.length !== quizFinalData.preguntas.length) {
    alert(`Has respondido ${seleccionadas.length} de ${quizFinalData.preguntas.length} preguntas. Responde todas antes de finalizar.`);
    return;
  }

  seleccionadas.forEach(op => {
    opcionesSeleccionadas[parseInt(op.dataset.quizId, 10)] = parseInt(op.dataset.opcion, 10);
  });

  try {
    const respuesta = await fetch('/api/curso-scrum/quiz-final', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': obtenerTokenCsrf() },
      body: JSON.stringify({ respuestas: opcionesSeleccionadas })
    });
    const datos = await respuesta.json();

    ultimoResultadoQuiz = {
      aprobado: datos.aprobado,
      calificacion: datos.calificacion,
      mensaje: datos.aprobado
        ? `Obtuviste ${datos.calificacion}%. Tu certificado en PDF ya está disponible arriba.`
        : `Obtuviste ${datos.calificacion}%. Se requiere mínimo 95% (9.5) para certificar. Puedes intentarlo nuevamente.`
    };

    await cargarCurso();
    // Mantener la vista de preguntas para mostrar el banner de resultado
    renderizarPreguntasQuizFinalInline();
  } catch (error) {
    alert(mensajeError(error, 'No se pudo enviar el Quiz Final. Revisa tu conexión e inténtalo de nuevo.'));
  }
}

/* ===========================================================================
   DRAWER RETRÁCTIL (DESKTOP + MÓVIL) Y DELEGACIÓN DE EVENTOS
   ========================================================================== */
function alternarSidebar() {
  const layout = document.getElementById('curso-layout');
  const sidebar = document.getElementById('curso-sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (window.innerWidth <= 900) {
    sidebar?.classList.toggle('abierto-movil');
    overlay?.classList.toggle('visible');
  } else {
    layout?.classList.toggle('sidebar-colapsado');
  }
}

function cerrarSidebarMovil() {
  document.getElementById('curso-sidebar')?.classList.remove('abierto-movil');
  document.getElementById('sidebar-overlay')?.classList.remove('visible');
}

function configurarEventos() {
  // Toggle Drawer
  document.getElementById('btn-toggle-sidebar')?.addEventListener('click', alternarSidebar);
  document.getElementById('sidebar-overlay')?.addEventListener('click', cerrarSidebarMovil);

  // Bloque 1 del Sidebar: Cambiar entre Módulos, Guía Práctica, Roles y Quiz Final
  document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.vista === 'modulos') modoLeccion = 'lectura';
      cambiarVista(btn.dataset.vista);
    });
  });

  // Filtros de categorías en Guía Práctica de ScrumFlow
  document.querySelectorAll('.guia-filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filtroGuia = btn.dataset.filtro;
      document.querySelectorAll('.guia-filtro-btn').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      aplicarFiltrosGuia();
    });
  });

  document.getElementById('btn-omitir-guia')?.addEventListener('click', () => {
    registrarEstadoGuia('omitido');
  });
  document.getElementById('btn-finalizar-guia')?.addEventListener('click', () => {
    registrarEstadoGuia('completado');
  });

  // Sub-pestañas dentro de Roles (PO, SM, Developers)
  document.querySelectorAll('.rol-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rolObjetivo = btn.dataset.rol;
      document.querySelectorAll('.rol-tab-btn').forEach(b => b.classList.remove('activo'));
      document.querySelectorAll('.panel-rol').forEach(p => p.classList.remove('activo'));
      btn.classList.add('activo');
      document.getElementById(`panel-${rolObjetivo}`)?.classList.add('activo');
    });
  });

  // Descargar Certificado PDF
  document.getElementById('btn-descargar-certificado')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const respuesta = await fetch('/api/curso-scrum/certificado/download');
      if (!respuesta.ok) throw new Error('Debes aprobar el Quiz Final (mínimo 9.5) para descargar el certificado.');

      const blob = await respuesta.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Certificado_ScrumFlow.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(mensajeError(err, 'No se pudo descargar el certificado. Inténtalo de nuevo.'));
    }
  });

  // Delegación global de clics dinámicos (Timeline, botones de lectura, quizzes)
  document.addEventListener('click', async (e) => {
    // Clic en un ítem del Timeline (Bloque 2 del Sidebar)
    const itemRuta = e.target.closest('.ruta-item');
    if (itemRuta) {
      leccionActivaId = parseInt(itemRuta.dataset.leccionId, 10);
      modoLeccion = 'lectura';
      cambiarVista('modulos');
      return;
    }

    // Botón "Anterior" en lección
    const btnAnterior = e.target.closest('#btn-leccion-anterior');
    if (btnAnterior) {
      leccionActivaId = parseInt(btnAnterior.dataset.id, 10);
      modoLeccion = 'lectura';
      ultimoResultadoQuiz = null;
      renderizarSidebarRuta();
      renderizarLeccionInline(leccionActivaId);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Botón "Completar y Continuar"
    const btnCompletar = e.target.closest('#btn-completar-continuar');
    if (btnCompletar) {
      const id = parseInt(btnCompletar.dataset.id, 10);
      const sig = btnCompletar.dataset.siguienteId;
      await completarLeccionYContinuar(id, sig);
      return;
    }

    // Abrir Quiz Modular inline
    const btnQuizInline = e.target.closest('#btn-abrir-quiz-inline');
    if (btnQuizInline) {
      modoLeccion = 'quiz';
      ultimoResultadoQuiz = null;
      renderizarQuizLeccionInline(parseInt(btnQuizInline.dataset.id, 10));
      return;
    }

    // Volver de Quiz Modular a la Lectura
    if (e.target.closest('#btn-volver-lectura')) {
      modoLeccion = 'lectura';
      ultimoResultadoQuiz = null;
      renderizarLeccionInline(leccionActivaId);
      return;
    }

    // Enviar Quiz Modular inline
    const btnEnviarQuiz = e.target.closest('#btn-enviar-quiz-inline');
    if (btnEnviarQuiz) {
      await enviarQuizInline(parseInt(btnEnviarQuiz.dataset.leccionId, 10));
      return;
    }

    // Iniciar Quiz Final Integrador inline
    if (e.target.closest('#btn-iniciar-quiz-final')) {
      ultimoResultadoQuiz = null;
      renderizarPreguntasQuizFinalInline();
      return;
    }

    // Salir / Volver a portada del Quiz Final
    if (e.target.closest('#btn-cancelar-quiz-final')) {
      ultimoResultadoQuiz = null;
      renderizarPortadaQuizFinal();
      return;
    }

    // Enviar Quiz Final Integrador inline
    if (e.target.closest('#btn-enviar-quiz-final-inline')) {
      await enviarQuizFinalInline();
    }
  });
}

document.addEventListener('DOMContentLoaded', inicializar);