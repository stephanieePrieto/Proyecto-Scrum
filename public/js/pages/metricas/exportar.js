/**
 * @file exportar.js
 * @description Lógica del cliente para HU-36 (Exportar reportes con barra de progreso).
 * @author Dana Carmona Santamaria
 */
import { api } from '../../core/api.js';

/**
 * Iniciar la exportación asíncrona y consultar su avance cada 500 ms (polling).
 * Si falla, muestra el error y deja el botón como "Reintentar".
 *
 * @param {number} proyectoId ID del proyecto.
 * @param {string} formato 'csv' o 'pdf'.
 * @param {string} alcance 'avance', 'distribucion' o 'todo'.
 * @param {HTMLElement} btnBoton Botón que desencadenó la acción (se deshabilita mientras se genera).
 * @param {HTMLElement} contBarra Contenedor de la barra de progreso.
 * @param {HTMLElement} avisoError Contenedor de errores.
 */
export async function procesarExportacionFront(proyectoId, formato, alcance, btnBoton, contBarra, avisoError) {
  const barra = contBarra.querySelector('.progreso__barra');
  const texto = contBarra.querySelector('.progreso__texto');
  const rol = contBarra.querySelector('[role="progressbar"]');
  const base = `/metricas/proyectos/${proyectoId}/exportar`;

  // Mostrar el error, ocultar la barra y permitir reintentar
  const fallar = (msj) => {
    contBarra.hidden = true;
    btnBoton.disabled = false;
    btnBoton.textContent = 'Reintentar';
    avisoError.textContent = msj;
    avisoError.hidden = false;
  };

  // Estado inicial de la interfaz
  btnBoton.disabled = true;
  avisoError.hidden = true;
  contBarra.hidden = false;
  barra.style.width = '0%';
  texto.textContent = 'Iniciando exportación...';

  // 1. Pedir al servidor que inicie el trabajo (aquí se rechazan permisos y "sin datos")
  let jobId;
  try {
    ({ jobId } = await api(base, { metodo: 'POST', cuerpo: { formato, alcance } }));
  } catch (e) {
    return fallar(e.cuerpo?.mensaje || e.message || 'Error al iniciar la exportación.');
  }

  // 2. Polling del progreso
  const timer = setInterval(async () => {
    try {
      const est = await api(`${base}/${jobId}`);
      barra.style.width = `${est.progreso}%`;
      rol?.setAttribute('aria-valuenow', est.progreso); // accesibilidad
      texto.textContent = `Generando reporte: ${est.progreso}%`;

      if (est.estado === 'error') {
        clearInterval(timer);
        fallar(est.error || 'No se pudo generar el reporte.');
      } else if (est.estado === 'completado') {
        clearInterval(timer);
        texto.textContent = '¡Reporte listo! Descargando...';

        // 3. Forzar la descarga en el navegador
        window.location.href = `/api${base}/${jobId}/descargar`;

        setTimeout(() => {
          contBarra.hidden = true;
          btnBoton.disabled = false;
          btnBoton.textContent = 'Generar reporte';
        }, 2500);
      }
    } catch (e) {
      clearInterval(timer);
      fallar(e.cuerpo?.mensaje || e.message || 'Error al consultar el progreso.');
    }
  }, 500);
}