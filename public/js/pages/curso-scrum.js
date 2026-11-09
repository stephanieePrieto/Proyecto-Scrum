/**
 * @file curso-scrum.js
 * @description Lógica interactiva para la navegación de lecciones, evaluación de quizzes y certificación.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { montarBarraSuperior } from '../core/layout.js';

let lecciones = [];
let quizzes = [];
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

/**
 * Obtiene el token CSRF generado por el middleware csrf.js (cookie csrfToken).
 */
function obtenerTokenCsrf() {
  const match = document.cookie.match(/(?:^|; )\s*csrfToken\s*=\s*([^;]+)/);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  const metaCsrf = document.querySelector('meta[name="csrf-token"]');
  if (metaCsrf) {
    return metaCsrf.getAttribute('content');
  }
  return '';
}

async function cargarCurso() {
  try {
    const respuesta = await fetch(`/api/curso-scrum/${proyectoId}`);
    if (!respuesta.ok) throw new Error('Error al cargar el curso');

    const datos = await respuesta.json();
    lecciones = datos.lecciones || [];
    quizzes = datos.quizzes || [];
    usuarioId = window.usuarioActual?.id;

    // Verificar si el usuario es Scrum Master o Product Owner para mostrar el botón
    const btnAvance = document.getElementById('btn-avance-equipo');
    if (btnAvance) {
      if (datos.rolEnProyecto === 'scrum_master' || datos.rolEnProyecto === 'product_owner') {
        btnAvance.style.display = 'inline-flex';
      } else {
        btnAvance.style.display = 'none';
      }
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
    if (!secciones[leccion.seccion]) {
      secciones[leccion.seccion] = [];
    }
    secciones[leccion.seccion].push(leccion);
  });

  let html = '';
  for (const [seccion, leccionesSeccion] of Object.entries(secciones)) {
    html += `
      <div class="seccion">
        <div class="seccion-titulo">
          <i class="fas fa-folder-open"></i>
          ${seccion}
        </div>
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
          ${esCompletada ? `
            <i class="fas fa-check-circle icono-completado" title="Lección completada"></i>
          ` : `
            <i class="fas fa-circle icono-pendiente" title="Pendiente"></i>
          `}
          ${tieneQuiz && quizAprobado ? `
            <i class="fas fa-star" style="color: var(--ambar-500);" title="Quiz aprobado"></i>
          ` : ''}
        </div>
      </div>
      <div class="leccion-contenido">
        ${decodeHtmlEntities(leccion.contenido).substring(0, 200)}${
          decodeHtmlEntities(leccion.contenido).length > 200 ? '...' : ''
        }
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
  if (texto) texto.textContent = `Avance: ${porcentaje}%`;
}

function verificarCertificado(tieneCertificado) {
  const alerta = document.getElementById('certificado-alerta');
  if (tieneCertificado && alerta) {
    alerta.classList.add('visible');
  }
}

function configurarEventos() {
  const btnRegresar = document.querySelector('.boton-regresar');
  if (btnRegresar) {
    btnRegresar.addEventListener('click', () => {
      localStorage.setItem('curso-scrum-scroll', window.scrollY);
    });
  }

  // Descarga del Certificado en PDF vía Fetch Blob
  const btnDescargarCert = document.getElementById('btn-descargar-certificado');
  if (btnDescargarCert) {
    btnDescargarCert.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const respuesta = await fetch('/api/curso-scrum/certificado/download');
        if (!respuesta.ok) {
          throw new Error('Debes completar el 100% del curso para descargar el certificado.');
        }

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
    if (btnVer) {
      const leccionId = parseInt(btnVer.dataset.leccionId);
      await marcarLeccionComoCompletada(leccionId);
    }
  });

  document.addEventListener('click', (e) => {
    const btnQuiz = e.target.closest('.btn-hacer-quiz');
    if (btnQuiz) {
      const leccionId = parseInt(btnQuiz.dataset.leccionId);
      mostrarQuiz(leccionId);
    }
  });

  const btnCerrarQuiz = document.getElementById('btn-cerrar-quiz');
  if (btnCerrarQuiz) {
    btnCerrarQuiz.addEventListener('click', () => {
      document.getElementById('modal-quiz').style.display = 'none';
    });
  }

  const btnEnviarQuiz = document.getElementById('btn-enviar-quiz');
  if (btnEnviarQuiz) {
    btnEnviarQuiz.addEventListener('click', async () => {
      const leccionId = parseInt(btnEnviarQuiz.dataset.leccionId);
      await enviarQuiz(leccionId);
    });
  }

  window.addEventListener('click', (e) => {
    const modal = document.getElementById('modal-quiz');
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });

  const savedScroll = localStorage.getItem('curso-scrum-scroll');
  if (savedScroll) {
    window.scrollTo(0, parseInt(savedScroll));
    localStorage.removeItem('curso-scrum-scroll');
  }
}

async function marcarLeccionComoCompletada(leccionId) {
  try {
    const leccion = lecciones.find(l => l.id === leccionId);
    if (!leccion) return;

    const contenidoCompleto = decodeHtmlEntities(leccion.contenido);

    const modal = document.createElement('div');
    modal.className = 'modal-leccion-overlay';
    modal.innerHTML = `
      <div style="
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); display: flex; justify-content: center;
        align-items: center; z-index: 1000;
      ">
        <div style="
          background: white; padding: 25px; border-radius: 12px;
          max-width: 800px; max-height: 80vh; overflow: auto; position: relative;
        ">
          <button id="cerrar-modal-lectura" style="
            position: absolute; top: 10px; right: 10px; background: none;
            border: none; font-size: 1.5rem; cursor: pointer;
          ">&times;</button>
          <h2>${leccion.titulo}</h2>
          <div style="margin-top: 15px; line-height: 1.6;">${contenidoCompleto}</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('cerrar-modal-lectura').addEventListener('click', () => modal.remove());

    const tokenCsrf = obtenerTokenCsrf();

    await fetch('/api/curso-scrum/progreso', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': tokenCsrf
      },
      body: JSON.stringify({
        leccionId,
        completada: true,
        posicionScroll: window.scrollY
      })
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

  if (quizzesLeccion.length === 0) {
    quizContenido.innerHTML = '<div class="aviso avisos--info">Esta lección no contiene evaluación en este momento.</div>';
    btnEnviar.style.display = 'none';
    modal.style.display = 'flex';
    return;
  }

  let html = '<div class="quiz-pregunta">Responde las siguientes preguntas:</div>';

  quizzesLeccion.forEach((quiz, index) => {
    let opcionesObj = quiz.opciones;
    if (typeof opcionesObj === 'string') {
      try { opcionesObj = JSON.parse(opcionesObj); } catch(e) {}
    }

    html += `
      <div class="quiz-pregunta" style="margin-top: 20px;">
        ${index + 1}. ${quiz.pregunta}
      </div>
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
  quizContenido.scrollTop = 0;

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
    const quizId = parseInt(opcion.dataset.quizId);
    const respuesta = parseInt(opcion.dataset.opcion);
    opcionesSeleccionadas[quizId] = respuesta;
  });

  try {
    const tokenCsrf = obtenerTokenCsrf();

    const respuesta = await fetch('/api/curso-scrum/quiz', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-csrf-token': tokenCsrf
      },
      body: JSON.stringify({
        leccionId,
        respuestas: opcionesSeleccionadas
      })
    });

    const datos = await respuesta.json();

    if (!respuesta.ok) {
      alert(`Error al procesar el quiz: ${datos.mensaje || datos.error || 'Acceso no autorizado'}`);
      return;
    }

    const calificacion = datos.calificacion !== undefined ? datos.calificacion : (datos.datos?.calificacion ?? 0);
    const aprobado = datos.aprobado !== undefined ? datos.aprobado : (datos.datos?.aprobado ?? false);

    if (aprobado) {
      alert(`¡Quiz aprobado con ${calificacion}%! Tu progreso ha sido actualizado.`);
    } else {
      alert(`Quiz no aprobado. Calificación: ${calificacion}%. Puedes reintentarlo.`);
    }

    document.getElementById('modal-quiz').style.display = 'none';
    await cargarCurso();
  } catch (error) {
    console.error('[curso-scrum] Error al enviar quiz:', error);
    alert('Error al enviar el quiz. Revisa tu conexión.');
  }
}

document.addEventListener('DOMContentLoaded', inicializar);