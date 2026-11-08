/**
 * @file curso-datos.js
 * @description Datos del curso de ScrumFlow
 * @author Stephanie Elizdeth Hernández Prieto
 */

export const DATOS_CURSO = {
  secciones: [
    {
      id: 1,
      titulo: "Módulo 1: Fundamentos de Scrum",
      color: "#6E9376",
      contenido: `
        <p>Scrum es un marco de trabajo ágil para gestionar proyectos complejos, especialmente cuando los requisitos cambian con frecuencia.</p>

        <h4 style="margin-top: 16px; color: #6E9376;">
          <i class="fas fa-mountain"></i> Los 3 Pilares de Scrum:
        </h4>
        <div style="display: grid; gap: 12px; margin-top: 12px;">
          <div style="background: #f0fdf4; padding: 12px; border-radius: 8px; border-left: 4px solid #6E9376;">
            <strong><i class="fas fa-eye"></i> Transparencia:</strong> Todos los aspectos del proceso deben ser visibles para quienes toman decisiones.
          </div>
          <div style="background: #f0f7ff; padding: 12px; border-radius: 8px; border-left: 4px solid #6A8CA0;">
            <strong><i class="fas fa-search"></i> Inspección:</strong> Los artefactos y el progreso deben inspeccionarse con frecuencia para detectar desviaciones.
          </div>
          <div style="background: #fef9f0; padding: 12px; border-radius: 8px; border-left: 4px solid #D6B98C;">
            <strong><i class="fas fa-sync-alt"></i> Adaptación:</strong> Si algo se desvía, el proceso debe ajustarse rápidamente.
          </div>
        </div>

        <h4 style="margin-top: 20px; color: #6E9376;">
          <i class="fas fa-star"></i> Valores de Scrum:
        </h4>
        <ul style="padding-left: 20px; margin-top: 8px;">
          <li><strong><i class="fas fa-handshake"></i> Compromiso</strong>: Todos se comprometen con los objetivos del equipo.</li>
          <li><strong><i class="fas fa-shield-alt"></i> Coraje</strong>: Para tomar decisiones difíciles.</li>
          <li><strong><i class="fas fa-target"></i> Enfoque</strong>: Mantener la concentración en el trabajo del Sprint.</li>
          <li><strong><i class="fas fa-door-open"></i> Apertura</strong>: Ser transparentes sobre el trabajo y los desafíos.</li>
          <li><strong><i class="fas fa-heart"></i> Respeto</strong>: Mutuo entre todos los miembros del equipo.</li>
        </ul>
      `
    },
    {
      id: 2,
      titulo: "Módulo 2: Roles en el Equipo Scrum",
      color: "#6A8CA0",
      contenido: `
        <p>En Scrum, cada rol tiene responsabilidades específicas y complementarias.</p>

        <div style="display: grid; gap: 16px; margin-top: 16px;">
          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #6E9376; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <h5 style="margin: 0 0 8px 0; color: #6E9376; font-size: 1rem;">
              <i class="fas fa-crown"></i> Product Owner (PO)
            </h5>
            <p style="margin: 0; color: #282828;">
              <strong>Responsabilidades:</strong> Gestionar el Product Backlog, maximizar el valor del producto y priorizar el trabajo.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #D6B98C; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <h5 style="margin: 0 0 8px 0; color: #D6B98C; font-size: 1rem;">
              <i class="fas fa-user-shield"></i> Scrum Master
            </h5>
            <p style="margin: 0; color: #282828;">
              <strong>Responsabilidades:</strong> Asegurar que el equipo Scrum entienda y aplique correctamente el marco de trabajo, eliminar impedimentos y facilitar eventos.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #6A8CA0; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <h5 style="margin: 0 0 8px 0; color: #6A8CA0; font-size: 1rem;">
              <i class="fas fa-users"></i> Developers
            </h5>
            <p style="margin: 0; color: #282828;">
              <strong>Responsabilidades:</strong> Crear el incremento del producto en cada Sprint, auto-organizarse y colaborar con el PO.
            </p>
          </div>
        </div>

        <div style="background: #F3F0E9; padding: 16px; border-radius: 12px; margin-top: 16px; border-left: 4px solid #282828;">
          <h5 style="margin: 0 0 8px 0; color: #282828; font-size: 1rem;">
            <i class="fas fa-info-circle"></i> Importante:
          </h5>
          <p style="margin: 0; color: #282828;">
            En ScrumFlow, los roles se asignan por proyecto en la tabla <code>miembros_proyecto</code>.
            Una misma persona puede tener diferentes roles en proyectos distintos.
          </p>
        </div>
      `
    },
    {
      id: 3,
      titulo: "Módulo 3: Artefactos de Scrum",
      color: "#C99A45",
      contenido: `
        <p>Los artefactos de Scrum representan el trabajo o el valor en diferentes formas, diseñados para maximizar la transparencia.</p>

        <div style="display: grid; gap: 16px; margin-top: 16px;">
          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #C99A45;">
            <h5 style="margin: 0 0 8px 0; color: #C99A45; font-size: 1rem;">
              <i class="fas fa-list"></i> Product Backlog
            </h5>
            <p style="margin: 0; color: #282828;">
              Lista ordenada de todo lo que se necesita en el producto. Es la única fuente de requisitos.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #6E9376;">
            <h5 style="margin: 0 0 8px 0; color: #6E9376; font-size: 1rem;">
              <i class="fas fa-tasks"></i> Sprint Backlog
            </h5>
            <p style="margin: 0; color: #282828;">
              Conjunto de elementos del Product Backlog seleccionados para el Sprint, más el plan para entregar el incremento.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #6A8CA0;">
            <h5 style="margin: 0 0 8px 0; color: #6A8CA0; font-size: 1rem;">
              <i class="fas fa-box"></i> Incremento
            </h5>
            <p style="margin: 0; color: #282828;">
              La suma de todos los elementos del Product Backlog completados durante un Sprint y el valor de los incrementos de todos los Sprints anteriores.
            </p>
          </div>
        </div>

        <div style="background: #F3F0E9; padding: 16px; border-radius: 12px; margin-top: 16px; border-left: 4px solid #282828;">
          <h5 style="margin: 0 0 8px 0; color: #282828; font-size: 1rem;">
            <i class="fas fa-lightbulb"></i> En ScrumFlow:
          </h5>
          <p style="margin: 0; color: #282828;">
            El <code>Product Backlog</code> se gestiona en el módulo <strong>Backlog</strong> (<code>/pages/backlog.html</code>).
          </p>
        </div>
      `
    },
    {
      id: 4,
      titulo: "Módulo 4: Eventos de Scrum",
      color: "#B85C50",
      contenido: `
        <p>Los eventos de Scrum son oportunidades formales para inspeccionar y adaptar los artefactos. Todos son limitados en el tiempo (time-boxed).</p>

        <div style="display: grid; gap: 16px; margin-top: 16px;">
          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #B85C50;">
            <h5 style="margin: 0 0 8px 0; color: #B85C50; font-size: 1rem;">
              <i class="fas fa-calendar-alt"></i> Sprint
            </h5>
            <p style="margin: 0; color: #282828;">
              Contenedor de un mes o menos que crea un incremento de producto "Hecho" utilizable y potencialmente entregable.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #6E9376;">
            <h5 style="margin: 0 0 8px 0; color: #6E9376; font-size: 1rem;">
              <i class="fas fa-calendar-check"></i> Sprint Planning
            </h5>
            <p style="margin: 0; color: #282828;">
              Inicia el Sprint definiendo qué se entregará y cómo se logrará el trabajo.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #6A8CA0;">
            <h5 style="margin: 0 0 8px 0; color: #6A8CA0; font-size: 1rem;">
              <i class="fas fa-comments"></i> Daily Scrum
            </h5>
            <p style="margin: 0; color: #282828;">
              Evento diario de 15 minutos para que el equipo sincronice actividades y cree un plan para las próximas 24 horas.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #C99A45;">
            <h5 style="margin: 0 0 8px 0; color: #C99A45; font-size: 1rem;">
              <i class="fas fa-clipboard-check"></i> Sprint Review
            </h5>
            <p style="margin: 0; color: #282828;">
              Inspecciona el incremento y adapta el Product Backlog según sea necesario.
            </p>
          </div>

          <div style="background: white; padding: 16px; border-radius: 12px; border: 2px solid #D6B98C;">
            <h5 style="margin: 0 0 8px 0; color: #D6B98C; font-size: 1rem;">
              <i class="fas fa-undo"></i> Sprint Retrospective
            </h5>
            <p style="margin: 0; color: #282828;">
              El equipo Scrum identifica qué salió bien, qué podría mejorarse y crea un plan de acción.
            </p>
          </div>
        </div>

        <div style="background: #F3F0E9; padding: 16px; border-radius: 12px; margin-top: 16px; border-left: 4px solid #282828;">
          <h5 style="margin: 0 0 8px 0; color: #282828; font-size: 1rem;">
            <i class="fas fa-lightbulb"></i> En ScrumFlow:
          </h5>
          <p style="margin: 0; color: #282828;">
            Las ceremonias se gestionan en sus respectivos módulos:
            <code>/pages/daily.html</code>, <code>/pages/review.html</code>, <code>/pages/retro.html</code>.
          </p>
        </div>
      `
    }
  ],

  quizzes: [
    {
      id: 1,
      leccion_id: 1,
      pregunta: "¿Cuál de los siguientes NO es un pilar de Scrum?",
      opciones: [
        "Transparencia",
        "Inspección",
        "Adaptación",
        "Documentación"
      ],
      respuesta_correcta: 3
    },
    {
      id: 2,
      leccion_id: 2,
      pregunta: "¿Quién es responsable de maximizar el valor del producto en Scrum?",
      opciones: [
        "Scrum Master",
        "Product Owner",
        "Developers",
        "Stakeholders"
      ],
      respuesta_correcta: 1
    },
    {
      id: 3,
      leccion_id: 3,
      pregunta: "¿Cuál de estos NO es un artefacto de Scrum?",
      opciones: [
        "Product Backlog",
        "Sprint Backlog",
        "Incremento",
        "Diagrama de Gantt"
      ],
      respuesta_correcta: 3
    },
    {
      id: 4,
      leccion_id: 4,
      pregunta: "¿Qué evento de Scrum tiene una duración máxima de 15 minutos?",
      opciones: [
        "Sprint Planning",
        "Sprint Review",
        "Sprint Retrospective",
        "Daily Scrum"
      ],
      respuesta_correcta: 3
    }
  ]
};