/**
 * @file curso-scrum.js
 * @description Interacción completa para módulos, pestañas de roles, quizzes y Quiz Final Integrador (20 preguntas).
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { montarBarraSuperior } from '../core/layout.js';

let lecciones = [];
let quizzes = [];
let quizFinalData = null;
let proyectoId = null;
let usuarioId = null;

async function inicializar() {
  montarBarraSuperior();
  proyectoId = window.proyectoActual?.id || 1;
  await cargarCurso();
  configurarEventos();
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

async function cargarCurso() {
  try {
    const respuesta = await fetch(`/api/curso-scrum/${proyectoId}`);
    if (!respuesta.ok) throw new Error('Error al cargar el curso');

    const datos = await respuesta.json();
    lecciones = datos.lecciones || [];
    quizzes = datos.quizzes || [];
    quizFinalData = datos.quizFinal || null;
    usuarioId = window.usuarioActual?.id;

    const btnAvance = document.getElementById('btn-avance-equipo');
    if (btnAvance) {
      btnAvance.style.display = (datos.rolEnProyecto === 'scrum_master' || datos.rolEnProyecto === 'product_owner') ? 'inline-flex' : 'none';
    }

    actualizarBarraProgreso(datos.porcentajeAvance);
    renderizarContenido();
    verificarCertificado(datos.certificado?.tieneCertificado);
  } catch (error) {
    console.error('[curso-scrum] Error:', error);
  }
}

function renderizarContenido() {
  const contenidoCurso = document.getElementById('contenido-curso');
  if (!contenidoCurso) return;

  const secciones = {};
  lecciones.forEach(leccion => {
    if (!secciones[leccion.seccion]) secciones[leccion.seccion] = [];
    secciones[leccion.seccion].push(leccion);
  });

  let html = '';
  for (const [seccion, leccionesSeccion] of Object.entries(secciones)) {
    html += `
      <div class="seccion">
        <div class="seccion-titulo"><i class="fas fa-folder-open"></i> ${seccion}</div>
        ${leccionesSeccion.map(renderizarLeccion).join('')}
      </div>
    `;
  }

  contenidoCurso.innerHTML = html;
}

function renderizarLeccion(leccion) {
  const esCompletada = leccion.completada;
  const quizAprobado = leccion.quiz_aprobado;
  const tieneQuiz = quizzes.some(q => q.leccion_id === leccion.id);

  return `
    <div class="leccion ${esCompletada ? 'leccion-completada' : ''}" data-leccion-id="${leccion.id}">
      <div class="leccion-header">
        <div class="leccion-titulo">${leccion.orden}. ${leccion.titulo}</div>
        <div class="leccion-estado">
          ${esCompletada ? '<i class="fas fa-check-circle icono-completado" title="Lección completada"></i>' : '<i class="fas fa-circle icono-pendiente" title="Pendiente"></i>'}
          ${tieneQuiz && quizAprobado ? '<i class="fas fa-star" style="color: var(--ambar-500, #d97706);" title="Quiz aprobado"></i>' : ''}
        </div>
      </div>
      <div class="leccion-contenido">
        ${decodeHtmlEntities(leccion.contenido).substring(0, 180)}...
      </div>
      <div class="leccion-acciones">
        <button class="btn-curso btn-curso--primario btn-ver-leccion" data-leccion-id="${leccion.id}">
          ${esCompletada ? 'Revisar' : 'Estudiar'} Lección
        </button>
        ${tieneQuiz ? `
          <button class="btn-curso btn-curso--secundario btn-hacer-quiz" data-leccion-id="${leccion.id}">
            ${quizAprobado ? 'Reintentar' : 'Hacer'} Quiz
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function actualizarBarraProgreso(porcentaje) {
  const barra = document.getElementById('barra-progreso');
  const texto = document.getElementById('porcentaje-avance');
  if (barra) barra.style.width = `${porcentaje}%`;
  if (texto) texto.textContent = `Avance Global: ${porcentaje}%`;
}

function verificarCertificado(tieneCertificado) {
  const alerta = document.getElementById('certificado-alerta');
  if (tieneCertificado && alerta) alerta.classList.add('visible');
}

function configurarEventos() {
  const btnRegresar = document.querySelector('.boton-regresar');
  if (btnRegresar) {
    btnRegresar.addEventListener('click', () => localStorage.setItem('curso-scrum-scroll', window.scrollY));
  }

  const btnDescargarCert = document.getElementById('btn-descargar-certificado');
  if (btnDescargarCert) {
    btnDescargarCert.addEventListener('click', async (e) => {
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
        alert(err.message);
      }
    });
  }

  document.addEventListener('click', async (e) => {
    const btnVer = e.target.closest('.btn-ver-leccion');
    if (btnVer) await marcarLeccionComoCompletada(parseInt(btnVer.dataset.leccionId));

    const btnQuiz = e.target.closest('.btn-hacer-quiz');
    if (btnQuiz) mostrarQuiz(parseInt(btnQuiz.dataset.leccionId));
  });

  const btnIniciarQuizFinal = document.getElementById('btn-iniciar-quiz-final');
  if (btnIniciarQuizFinal) {
    btnIniciarQuizFinal.addEventListener('click', () => mostrarQuizFinal());
  }

  const btnCerrarQuiz = document.getElementById('btn-cerrar-quiz');
  if (btnCerrarQuiz) {
    btnCerrarQuiz.addEventListener('click', () => document.getElementById('modal-quiz').style.display = 'none');
  }

  const btnEnviarQuiz = document.getElementById('btn-enviar-quiz');
  if (btnEnviarQuiz) {
    btnEnviarQuiz.addEventListener('click', async () => {
      const esFinal = btnEnviarQuiz.dataset.esQuizFinal === 'true';
      if (esFinal) {
        await enviarQuizFinal();
      } else {
        await enviarQuiz(parseInt(btnEnviarQuiz.dataset.leccionId));
      }
    });
  }

  window.addEventListener('click', (e) => {
    const modal = document.getElementById('modal-quiz');
    if (e.target === modal) modal.style.display = 'none';
  });

  configurarPestanas();
  configurarSubPestanasRoles();
}

function configurarPestanas() {
  const botonesPestana = document.querySelectorAll('.pestana-btn');
  const contenidosPestana = document.querySelectorAll('.contenido-pestana');

  botonesPestana.forEach(btn => {
    btn.addEventListener('click', () => {
      const pestanaObjetivo = btn.dataset.pestana;
      botonesPestana.forEach(b => b.classList.remove('activa'));
      contenidosPestana.forEach(c => c.classList.remove('activa'));
      btn.classList.add('activa');
      const panelObjetivo = document.getElementById(`seccion-${pestanaObjetivo}`);
      if (panelObjetivo) panelObjetivo.classList.add('activa');
    });
  });
}

function configurarSubPestanasRoles() {
  const botonesRol = document.querySelectorAll('.rol-tab-btn');
  const panelesRol = document.querySelectorAll('.panel-rol');

  botonesRol.forEach(btn => {
    btn.addEventListener('click', () => {
      const rolObjetivo = btn.dataset.rol;
      botonesRol.forEach(b => b.classList.remove('activo'));
      panelesRol.forEach(p => p.classList.remove('activo'));
      btn.classList.add('activo');
      const panelSeleccionado = document.getElementById(`panel-${rolObjetivo}`);
      if (panelSeleccionado) panelSeleccionado.classList.add('activo');
    });
  });
}

async function marcarLeccionComoCompletada(leccionId) {
  try {
    const leccion = lecciones.find(l => l.id === leccionId);
    if (!leccion) return;

    const modal = document.createElement('div');
    modal.className = 'modal-leccion-overlay';
    modal.innerHTML = `
      <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000;">
        <div style="background: white; padding: 25px; border-radius: 12px; max-width: 800px; max-height: 80vh; overflow: auto; position: relative;">
          <button id="cerrar-modal-lectura" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.5rem; cursor: pointer;">&times;</button>
          <h2>${leccion.titulo}</h2>
          <div style="margin-top: 15px; line-height: 1.6;">${decodeHtmlEntities(leccion.contenido)}</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('cerrar-modal-lectura').addEventListener('click', () => modal.remove());

    await fetch('/api/curso-scrum/progreso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': obtenerTokenCsrf() },
      body: JSON.stringify({ leccionId, completada: true, posicionScroll: window.scrollY })
    });
    await cargarCurso();
  } catch (error) {
    console.error('[curso-scrum] Error al marcar lección:', error);
  }
}

function mostrarQuiz(leccionId) {
  const modal = document.getElementById('modal-quiz');
  const quizContenido = document.getElementById('quiz-contenido');
  const btnEnviar = document.getElementById('btn-enviar-quiz');

  const leccion = lecciones.find(l => l.id === leccionId);
  if (!leccion) return;

  const quizzesLeccion = quizzes.filter(q => q.leccion_id === leccionId);
  document.getElementById('quiz-leccion-titulo').textContent = leccion.titulo;
  btnEnviar.dataset.leccionId = leccionId;
  btnEnviar.dataset.esQuizFinal = 'false';

  let html = '<div class="quiz-pregunta">Responde las siguientes preguntas:</div>';
  quizzesLeccion.forEach((quiz, index) => {
    let opcionesObj = quiz.opciones;
    if (typeof opcionesObj === 'string') { try { opcionesObj = JSON.parse(opcionesObj); } catch(e) {} }
    html += `
      <div class="quiz-pregunta" style="margin-top: 20px;">${index + 1}. ${quiz.pregunta}</div>
      <div class="quiz-opciones" data-quiz-id="${quiz.id}">
        ${Object.entries(opcionesObj).map(([key, valor]) => `
          <div class="quiz-opcion" data-opcion="${key}" data-quiz-id="${quiz.id}">
            ${String.fromCharCode(65 + parseInt(key))}. ${valor}
          </div>
        `).join('')}
      </div>
    `;
  });

  quizContenido.innerHTML = html;
  btnEnviar.style.display = 'inline-flex';
  modal.style.display = 'flex';

  activarOpcionesQuiz();
}

function mostrarQuizFinal() {
  if (!quizFinalData || !quizFinalData.preguntas) return;

  const modal = document.getElementById('modal-quiz');
  const quizContenido = document.getElementById('quiz-contenido');
  const btnEnviar = document.getElementById('btn-enviar-quiz');

  document.getElementById('quiz-leccion-titulo').textContent = 'Quiz Final Integrador (20 Preguntas)';
  btnEnviar.dataset.esQuizFinal = 'true';

  let html = '<div class="aviso avisos--info">Responde las 20 preguntas. Mínimo 95% de acierto para obtener el certificado.</div>';

  quizFinalData.preguntas.forEach((quiz, index) => {
    let opcionesObj = quiz.opciones;
    if (typeof opcionesObj === 'string') { try { opcionesObj = JSON.parse(opcionesObj); } catch(e) {} }
    html += `
      <div class="quiz-pregunta" style="margin-top: 20px;">${index + 1}. ${quiz.pregunta}</div>
      <div class="quiz-opciones" data-quiz-id="${quiz.id}">
        ${Object.entries(opcionesObj).map(([key, valor]) => `
          <div class="quiz-opcion" data-opcion="${key}" data-quiz-id="${quiz.id}">
            ${String.fromCharCode(65 + parseInt(key))}. ${valor}
          </div>
        `).join('')}
      </div>
    `;
  });

  quizContenido.innerHTML = html;
  btnEnviar.style.display = 'inline-flex';
  modal.style.display = 'flex';

  activarOpcionesQuiz();
}

function activarOpcionesQuiz() {
  const opciones = document.querySelectorAll('.quiz-opcion');
  opciones.forEach(opcion => {
    opcion.addEventListener('click', () => {
      const quizId = opcion.dataset.quizId;
      const opcionesQuiz = document.querySelectorAll(`.quiz-opcion[data-quiz-id="${quizId}"]`);
      opcionesQuiz.forEach(o => o.classList.remove('seleccionada'));
      opcion.classList.add('seleccionada');
    });
  });
}

async function enviarQuiz(leccionId) {
  const opcionesSeleccionadas = {};
  const opciones = document.querySelectorAll('.quiz-opcion.seleccionada');
  const quizzesLeccion = quizzes.filter(q => q.leccion_id === leccionId);

  if (opciones.length !== quizzesLeccion.length) {
    alert('Por favor, responde todas las preguntas antes de enviar.');
    return;
  }

  opciones.forEach(opcion => {
    opcionesSeleccionadas[parseInt(opcion.dataset.quizId)] = parseInt(opcion.dataset.opcion);
  });

  try {
    const respuesta = await fetch('/api/curso-scrum/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': obtenerTokenCsrf() },
      body: JSON.stringify({ leccionId, respuestas: opcionesSeleccionadas })
    });
    const datos = await respuesta.json();
    alert(`Quiz finalizado. Calificación: ${datos.calificacion}%`);
    document.getElementById('modal-quiz').style.display = 'none';
    await cargarCurso();
  } catch (error) {
    alert('Error al enviar el quiz.');
  }
}

async function enviarQuizFinal() {
  const opcionesSeleccionadas = {};
  const opciones = document.querySelectorAll('.quiz-opcion.seleccionada');

  if (opciones.length !== quizFinalData.preguntas.length) {
    alert(`Has respondido ${opciones.length} de 20 preguntas. Por favor responde todas para enviar.`);
    return;
  }

  opciones.forEach(opcion => {
    opcionesSeleccionadas[parseInt(opcion.dataset.quizId)] = parseInt(opcion.dataset.opcion);
  });

  try {
    const respuesta = await fetch('/api/curso-scrum/quiz-final', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': obtenerTokenCsrf() },
      body: JSON.stringify({ respuestas: opcionesSeleccionadas })
    });

    const datos = await respuesta.json();

    if (datos.aprobado) {
      alert(`¡FELICIDADES! Has aprobado el Quiz Final con ${datos.calificacion}%. Tu certificado ha sido emitido.`);
    } else {
      alert(`Puntuación: ${datos.calificacion}%. Se requiere mínimo 95% (9.5) para certificar. Puedes reintentar.`);
    }

    document.getElementById('modal-quiz').style.display = 'none';
    await cargarCurso();
  } catch (error) {
    alert('Error al enviar el Quiz Final.');
  }
}

document.addEventListener('DOMContentLoaded', inicializar);