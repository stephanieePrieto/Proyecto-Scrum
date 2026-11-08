/**
 * @file curso-scrum.js
 * @description Lógica del curso de ScrumFlow
 * @author Stephanie Elizdeth Hernández Prieto
 */

// ⚡ RUTAS CORREGIDAS para tu estructura:
import { montarBarraSuperior } from '../core/layout.js';
import { DATOS_CURSO } from './curso-datos.js';

// Montar barra superior
montarBarraSuperior();

// Estado global
const CLAVE_STORAGE = 'scrumflow_curso_progreso';
const estadoApp = {
  progreso: {
    modulosCompletados: [],
    quizRespondido: false,
    puntaje: 0,
    fechaUltimaActualizacion: null
  },
  respuestasUsuario: {}
};

// Referencias DOM
const elementosDOM = {
  contenedorModulos: document.getElementById('modulos-curso-lista'),
  barraProgreso: document.getElementById('progreso-lectura'),
  contenedorQuiz: document.getElementById('cuestionario-contenedor'),
  btnEnviarQuiz: document.getElementById('btn-enviar-quiz'),
  resultadoQuiz: document.getElementById('resultado-quiz'),
  avisoGuardado: document.getElementById('aviso-guardado'),
  estadoQuiz: document.getElementById('estado-quiz')
};

// ========== FUNCIONES DE PERSISTENCIA ==========
function cargarProgreso() {
  try {
    const guardado = localStorage.getItem(CLAVE_STORAGE);
    if (guardado) {
      estadoApp.progreso = JSON.parse(guardado);
      // Validar módulos
      estadoApp.progreso.modulosCompletados = estadoApp.progreso.modulosCompletados.filter(
        id => DATOS_CURSO.secciones.some(s => s.id === id)
      );
    }
  } catch (error) {
    console.warn('[curso-scrum] Error al cargar progreso:', error);
  }
}

function guardarProgreso() {
  try {
    estadoApp.progreso.fechaUltimaActualizacion = new Date().toISOString();
    localStorage.setItem(CLAVE_STORAGE, JSON.stringify(estadoApp.progreso));
    if (elementosDOM.avisoGuardado) {
      elementosDOM.avisoGuardado.hidden = false;
      setTimeout(() => elementosDOM.avisoGuardado.hidden = true, 3000);
    }
  } catch (error) {
    console.warn('[curso-scrum] Error al guardar progreso:', error);
  }
}

function marcarModuloCompletado(moduloId) {
  if (!estadoApp.progreso.modulosCompletados.includes(moduloId)) {
    estadoApp.progreso.modulosCompletados.push(moduloId);
    guardarProgreso();
  }
}

// ========== FUNCIONES DE RENDERIZADO ==========
function pintarModulos() {
  const { contenedorModulos } = elementosDOM;
  if (!contenedorModulos || !DATOS_CURSO?.secciones) return;

  contenedorModulos.innerHTML = DATOS_CURSO.secciones.map(seccion => {
    const estaCompletado = estadoApp.progreso.modulosCompletados.includes(seccion.id);
    return `
      <section class="curso-tarjeta-modulo ${estaCompletado ? 'modulo-completado' : ''}"
               data-seccion-id="${seccion.id}">
        <h2 style="color: ${seccion.color}; margin-bottom: 12px; font-size: 1.25rem;">
          ${seccion.titulo}
        </h2>
        <div class="curso-cuerpo" style="line-height: 1.7; color: var(--slate-700, #334155);">
          ${seccion.contenido}
        </div>
      </section>
    `;
  }).join('');

  configurarObservadoresModulos();
}

function configurarObservadoresModulos() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const moduloId = parseInt(entry.target.dataset.seccionId);
        if (!isNaN(moduloId)) {
          marcarModuloCompletado(moduloId);
          entry.target.classList.add('modulo-completado');
        }
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.curso-tarjeta-modulo').forEach(modulo => observer.observe(modulo));
}

function pintarQuiz() {
  const { contenedorQuiz, btnEnviarQuiz, estadoQuiz } = elementosDOM;
  if (!contenedorQuiz || !DATOS_CURSO?.quizzes) return;

  if (estadoApp.progreso.quizRespondido) {
    estadoQuiz.textContent = `✓ Completado: ${estadoApp.progreso.puntaje}%`;
    estadoQuiz.style.color = estadoApp.progreso.puntaje >= 75 ? '#10b981' : '#f59e0b';
    btnEnviarQuiz.disabled = true;
    btnEnviarQuiz.textContent = '✓ Quiz calificado';
  }

  contenedorQuiz.innerHTML = DATOS_CURSO.quizzes.map((q, index) => `
    <div class="pregunta-item" style="margin-bottom: 24px; padding: 20px; background: white; border-radius: 12px; border: 1px solid #e2e8f0;"
         data-quiz-id="${q.id}" data-correcta="${q.respuesta_correcta}">
      <p style="font-weight: 600; margin: 0 0 12px 0; color: #1e293b;">
        ${index + 1}. ${q.pregunta}
      </p>
      <div class="opciones-lista" data-grupo-quiz="${q.id}" style="display: grid; gap: 8px;">
        ${q.opciones.map((opcion, i) => `
          <button type="button" class="quiz-opcion" data-opcion-index="${i}"
                  style="padding: 12px 16px; border-radius: 8px; border: 2px solid #e2e8f0; background: white; cursor: pointer; text-align: left; font-size: 0.95rem; transition: all 0.2s;">
            ${String.fromCharCode(65 + i)}. ${opcion}
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');

  configurarEventosQuiz();
}

function configurarEventosQuiz() {
  const { contenedorQuiz } = elementosDOM;
  if (!contenedorQuiz) return;

  contenedorQuiz.addEventListener('click', (e) => {
    const boton = e.target.closest('.quiz-opcion');
    if (!boton || estadoApp.progreso.quizRespondido) return;

    const lista = boton.closest('.opciones-lista');
    const quizId = parseInt(lista.closest('.pregunta-item').dataset.quizId);
    const opcionIndex = parseInt(boton.dataset.opcionIndex);

    lista.querySelectorAll('.quiz-opcion').forEach(b => {
      b.classList.remove('seleccionada');
      b.style.background = 'white';
      b.style.borderColor = '#e2e8f0';
    });

    boton.classList.add('seleccionada');
    boton.style.background = '#dbeafe';
    boton.style.borderColor = '#3b82f6';
    estadoApp.respuestasUsuario[quizId] = opcionIndex;
  });
}

// ========== FUNCIONES DE CALIFICACIÓN ==========
function calificarQuiz() {
  const { btnEnviarQuiz, resultadoQuiz, estadoQuiz } = elementosDOM;
  const preguntas = document.querySelectorAll('.pregunta-item');
  let correctas = 0;
  const total = preguntas.length;

  // Validar que todas las preguntas tengan respuesta
  let todasRespondidas = true;
  preguntas.forEach(p => {
    const quizId = parseInt(p.dataset.quizId);
    if (estadoApp.respuestasUsuario[quizId] === undefined) {
      todasRespondidas = false;
    }
  });

  if (!todasRespondidas) {
    resultadoQuiz.textContent = '⚠️ Responde todas las preguntas';
    resultadoQuiz.style.color = '#ef4444';
    return;
  }

  preguntas.forEach(p => {
    const quizId = parseInt(p.dataset.quizId);
    const indiceCorrecto = parseInt(p.dataset.correcta);
    const respuestaElegida = estadoApp.respuestasUsuario[quizId];
    const botones = p.querySelectorAll('.quiz-opcion');

    botones.forEach((b, idx) => {
      b.disabled = true;
      if (idx === indiceCorrecto) {
        b.classList.add('correcta');
        b.style.background = '#dcfce7';
        b.style.borderColor = '#10b981';
        b.style.color = '#166534';
      } else if (idx === respuestaElegida) {
        b.classList.add('incorrecta');
        b.style.background = '#fee2e2';
        b.style.borderColor = '#ef4444';
        b.style.color = '#991b1b';
      } else {
        b.style.background = 'var(--slate-50, #f8fafc)';
        b.style.borderColor = '#e2e8f0';
        b.style.color = '#64748b';
      }
    });

    if (respuestaElegida === indiceCorrecto) correctas++;
  });

  const porcentaje = Math.round((correctas / total) * 100);
  resultadoQuiz.textContent = `Calificación: ${porcentaje}% (${correctas}/${total} correctas)`;
  resultadoQuiz.style.color = porcentaje >= 75 ? '#10b981' : porcentaje >= 50 ? '#f59e0b' : '#ef4444';

  estadoApp.progreso.quizRespondido = true;
  estadoApp.progreso.puntaje = porcentaje;
  guardarProgreso();

  btnEnviarQuiz.textContent = '✓ Quiz calificado';
  btnEnviarQuiz.disabled = true;
  estadoQuiz.textContent = `✓ Completado: ${porcentaje}%`;
  estadoQuiz.style.color = porcentaje >= 75 ? '#10b981' : '#f59e0b';
}

// ========== BARRA DE PROGRESO ==========
function configurarBarraProgreso() {
  const { barraProgreso } = elementosDOM;
  if (!barraProgreso) return;

  window.addEventListener('scroll', () => {
    const alturaTotal = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    if (alturaTotal <= 0) return;
    const scrollTop = window.scrollY;
    const porcentaje = (scrollTop / alturaTotal) * 100;
    barraProgreso.style.width = `${Math.min(porcentaje, 100)}%`;
  });
  window.dispatchEvent(new Event('scroll'));
}

// ========== INICIALIZACIÓN ==========
function inicializar() {
  cargarProgreso();
  pintarModulos();
  pintarQuiz();
  configurarBarraProgreso();

  if (elementosDOM.btnEnviarQuiz) {
    elementosDOM.btnEnviarQuiz.addEventListener('click', calificarQuiz);
  }
}

// Iniciar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializar);
} else {
  inicializar();
}