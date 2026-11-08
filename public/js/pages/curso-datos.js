/**
 * @file curso-datos.js
 * @description Datos del curso de ScrumFlow
 * @author Stephanie Elizdeth Hernández Prieto
 */

export const DATOS_CURSO = {
  secciones: [
    {
      id: 1,
      titulo: "📚 Módulo 1: Fundamentos de Scrum",
      color: "#055651",
      contenido: `
        <p>Scrum es un marco de trabajo ágil para gestionar proyectos complejos, especialmente cuando los requisitos cambian con frecuencia.</p>

        <h4 style="margin-top: 16px; color: #055651;">🏛️ Los 3 Pilares de Scrum:</h4>
        <div style="display: grid; gap: 12px; margin-top: 12px;">
          <div style="background: #e6f4f2; padding: 12px; border-radius: 8px; border-left: 4px solid #055651;">
            <strong>Transparencia:</strong> Todos los aspectos del proceso deben ser visibles para quienes toman decisiones.
          </div>
          <div style="background: #e0f2fe; padding: 12px; border-radius: 8px; border-left: 4px solid #3b82f6;">
            <strong>Inspección:</strong> Los artefactos y el progreso deben inspeccionarse con frecuencia para detectar desviaciones.
          </div>
          <div style="background: #f0fdf4; padding: 12px; border-radius: 8px; border-left: 4px solid #10b981;">
            <strong>Adaptación:</strong> Si algo se desvía, el proceso debe ajustarse rápidamente.
          </div>
        </div>

        <h4 style="margin-top: 20px; color: #055651;">🎯 Valores de Scrum:</h4>
        <ul style="padding-left: 20px; margin-top: 8px;">
          <li><strong>Compromiso</strong>: Todos se comprometen con los objetivos del equipo.</li>
          <li><strong>Coraje</strong>: Para tomar decisiones difíciles.</li>
          <li><strong>Enfoque</strong>: Mantener la concentración en el trabajo del Sprint.</li>
          <li><strong>Apertura</strong>: Ser transparentes sobre el trabajo y los desafíos.</li>
          <li><strong>Respeto</strong>: Mutuo entre todos los miembros del equipo.</li>
        </ul>
      `
    },
    {
      id: 2,
      titulo: "👥 Módulo 2: Roles en el Equipo Scrum",
      color: "#3b82f6",
      contenido: `
        <p>En Scrum, cada rol tiene responsabilidades específicas y complementarias.</p>

        <div style="display: grid; gap: 16px; margin-top: 16px;">
          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #055651; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <h5 style="margin: 0 0 8px 0; color: #055651; font-size: 1rem;">
              <i class="fas fa-crown"></i> Product Owner (PO)
            </h5>
            <p style="margin: 0; color: #1e293b; font-size: 0.95rem;">
              <strong>Responsabilidad:</strong> Maximizar el valor del producto. Gestiona el Product Backlog, prioriza historias de usuario y define criterios de aceptación.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #3b82f6; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <h5 style="margin: 0 0 8px 0; color: #3b82f6; font-size: 1rem;">
              <i class="fas fa-user-shield"></i> Scrum Master (SM)
            </h5>
            <p style="margin: 0; color: #1e293b; font-size: 0.95rem;">
              <strong>Responsabilidad:</strong> Eliminar impedimentos, facilitar ceremonias y promover la mejora continua. Es un líder servidor.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #10b981; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <h5 style="margin: 0 0 8px 0; color: #10b981; font-size: 1rem;">
              <i class="fas fa-code"></i> Developers
            </h5>
            <p style="margin: 0; color: #1e293b; font-size: 0.95rem;">
              <strong>Responsabilidad:</strong> Construir incrementos de producto utilizables. Se auto-organizan para cumplir el Sprint Goal.
            </p>
          </div>
        </div>
      `
    },
    {
      id: 3,
      titulo: "📋 Módulo 3: El Product Backlog",
      color: "#7c3aed",
      contenido: `
        <p>El <strong>Product Backlog</strong> es la lista emergente y ordenada de todo lo necesario en el producto.</p>

        <div style="background: #f5f3ff; padding: 16px; border-radius: 12px; border: 1px solid #7c3aed; margin-top: 16px;">
          <h4 style="margin: 0 0 12px 0; color: #7c3aed;">Características:</h4>
          <ul style="padding-left: 20px; margin: 0; color: #475569;">
            <li><strong>Dinámico:</strong> Evoluciona constantemente.</li>
            <li><strong>Priorizado:</strong> Los elementos más valiosos están arriba.</li>
            <li><strong>Detallado:</strong> Los elementos de mayor prioridad tienen más detalle.</li>
            <li><strong>Estimado:</strong> Cada elemento tiene una estimación de esfuerzo.</li>
          </ul>
        </div>

        <h4 style="margin-top: 20px; color: #7c3aed;">Historias de Usuario:</h4>
        <blockquote style="background: white; padding: 16px; border-left: 4px solid #7c3aed; border-radius: 8px; margin: 16px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
          <p style="margin: 0; font-style: italic; color: #1e293b;">
            "Como <span style="color: #7c3aed; font-weight: 600;">[usuario]</span>, quiero <span style="color: #7c3aed; font-weight: 600;">[funcionalidad]</span> para <span style="color: #7c3aed; font-weight: 600;">[beneficio]</span>."
          </p>
        </blockquote>
      `
    },
    {
      id: 4,
      titulo: "⚡ Módulo 4: Sprints y Ceremonias",
      color: "#f59e0b",
      contenido: `
        <p>Los <strong>Sprints</strong> son el corazón de Scrum: iteraciones de tiempo fijo (1-4 semanas) para entregar valor.</p>

        <h4 style="margin-top: 20px; color: #f59e0b;">📅 Ceremonias:</h4>

        <div style="display: grid; gap: 12px; margin-top: 12px;">
          <div style="background: #fef3c7; padding: 12px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <strong>Sprint Planning:</strong> Seleccionar trabajo para el Sprint (máx. 8 horas).
          </div>
          <div style="background: #fef3c7; padding: 12px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <strong>Daily Scrum:</strong> Sincronización diaria de 15 minutos.
          </div>
          <div style="background: #fef3c7; padding: 12px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <strong>Sprint Review:</strong> Demostrar el incremento (máx. 4 horas).
          </div>
          <div style="background: #fef3c7; padding: 12px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <strong>Sprint Retrospective:</strong> Mejorar el proceso (máx. 3 horas).
          </div>
        </div>

        <h4 style="margin-top: 20px; color: #f59e0b;">Tablero Kanban:</h4>
        <p>Herramienta visual para gestionar el flujo de trabajo con columnas como: <strong>Por hacer</strong>, <strong>En progreso</strong>, <strong>Hecho</strong>.</p>
      `
    }
  ],
  quizzes: [
    {
      id: 1,
      pregunta: "¿Cuáles son los 3 pilares de Scrum?",
      opciones: [
        "Velocidad, Costo, Alcance",
        "Transparencia, Inspección, Adaptación",
        "Planificación, Ejecución, Control",
        "Jerarquía, Burocracia, Reportes"
      ],
      respuesta_correcta: 1
    },
    {
      id: 2,
      pregunta: "¿Quién gestiona el Product Backlog?",
      opciones: [
        "Scrum Master",
        "Product Owner",
        "Developer",
        "Administrador"
      ],
      respuesta_correcta: 1
    },
    {
      id: 3,
      pregunta: "¿Qué formato usa una Historia de Usuario?",
      opciones: [
        "Título, Descripción, Prioridad",
        "Como [usuario], quiero [funcionalidad] para [beneficio]",
        "Código, Nombre, Fecha",
        "Problema, Solución, Costo"
      ],
      respuesta_correcta: 1
    },
    {
      id: 4,
      pregunta: "¿Cuánto dura un Daily Scrum?",
      opciones: [
        "1 hora",
        "15 minutos",
        "30 minutos",
        "2 horas"
      ],
      respuesta_correcta: 1
    },
    {
      id: 5,
      pregunta: "¿Qué NO es responsabilidad del Scrum Master?",
      opciones: [
        "Eliminar impedimentos",
        "Facilitar ceremonias",
        "Asignar tareas individuales",
        "Promover la mejora continua"
      ],
      respuesta_correcta: 2
    }
  ]
};