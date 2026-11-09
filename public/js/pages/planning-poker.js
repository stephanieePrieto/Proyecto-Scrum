/** HU-05 · Planning Poker grupal con estimación Fibonacci y cierre en cuatro rondas. */
import { montarBarraSuperior } from '../core/layout.js';
import { api } from '../core/api.js';
import { cargarPermisos, rolActual } from '../core/permisos-ui.js';

montarBarraSuperior();
const $ = (id) => document.getElementById(id);
const parametros = new URLSearchParams(location.search);
const proyectoId = parametros.get('proyecto') || localStorage.getItem('proyectoActivo');
const historias = [];

if (proyectoId) $('volver-backlog').href = `/pages/backlog.html?proyecto=${encodeURIComponent(proyectoId)}`;

function avisar(mensaje, tipo = 'error') {
  const elemento = $('mensaje-poker');
  elemento.textContent = mensaje;
  elemento.className = `alerta alerta--${tipo}`;
  elemento.hidden = false;
}

function historiaActual() {
  return historias.find((h) => String(h.id) === $('pp-historia').value) ?? null;
}

function actualizarControles() {
  const h = historiaActual();
  $('pp-detalle').textContent = !h
    ? 'Selecciona una historia para consultar su estimación.'
    : h.puntos == null
      ? `HU-${String(h.numero_hu).padStart(2, '0')} · ${h.titulo} · Sin estimar`
      : `HU-${String(h.numero_hu).padStart(2, '0')} · ${h.titulo} · ${h.puntos} puntos (ya estimada)`;
}

async function cargarHistorias(mantenerSeleccion = true) {
  if (!proyectoId || !/^\d+$/.test(String(proyectoId)) || Number(proyectoId) <= 0) {
    avisar('Selecciona un proyecto desde Dashboard para estimar sus historias.');
    return;
  }
  const anterior = mantenerSeleccion ? $('pp-historia').value : '';
  $('pp-historia').disabled = true;
  try {
    const datos = await api(`/poker/proyecto/${encodeURIComponent(proyectoId)}/historias`);
    historias.splice(0, historias.length, ...(datos.historias ?? []));
    const selector = $('pp-historia');
    selector.replaceChildren(new Option('Selecciona una historia', ''));
    for (const h of historias) {
      const texto = `HU-${String(h.numero_hu).padStart(2, '0')} · ${h.titulo} · ${h.puntos == null ? 'Sin estimar' : `${h.puntos} pts`}`;
      selector.add(new Option(texto, String(h.id)));
    }
    if (historias.some((h) => String(h.id) === anterior)) selector.value = anterior;
    selector.disabled = historias.length === 0;
    if (!historias.length) avisar('Este proyecto no tiene historias disponibles para estimar.', 'advertencia');
    actualizarControles();
  } catch (error) {
    avisar(error.cuerpo?.mensaje || error.message || 'No se pudieron cargar las historias.');
    actualizarControles();
  }
}

$('pp-historia').addEventListener('change', () => {
  $('mensaje-poker').hidden = true;
  actualizarControles();
});
$('pp-actualizar').addEventListener('click', () => cargarHistorias());
if (proyectoId) {
  try {
    await cargarPermisos(Number(proyectoId));
  } catch {
    avisar('No se pudieron comprobar los permisos de este proyecto.');
  }
  await cargarHistorias(false);
} else {
  avisar('Selecciona un proyecto desde Dashboard para continuar.');
}
actualizarControles();

// HU-05 · Planning Poker grupal. Los votos ocultos solo se consultan al servidor.
let sesionPoker = null;
let procesandoRonda = false;
let permisoModerador = ['scrum_master', 'product_owner'].includes(rolActual());

function rutaRonda(historiaId) {
  return `/poker/proyecto/${encodeURIComponent(proyectoId)}/historias/${historiaId}`;
}

function pintarRonda() {
  const historia = historiaActual();
  const sesion = sesionPoker;
  permisoModerador = ['scrum_master', 'product_owner'].includes(rolActual());
  $('pp-iniciar').textContent = 'Iniciar ronda';
  $('pp-iniciar').disabled = procesandoRonda || !permisoModerador || !historia || historia.puntos != null || Boolean(sesion && sesion.estado !== 'cerrada');
  $('pp-panel-ronda').hidden = !sesion;
  if (!historia) {
    $('pp-estado-ronda').textContent = 'Selecciona una historia para comenzar.';
  } else if (!sesion) {
    $('pp-estado-ronda').textContent = historia.puntos == null
      ? 'Todavía no hay una ronda para esta historia.'
      : 'Esta historia ya tiene una estimación guardada.';
  } else {
    const estados = {
      votando: 'Ronda abierta: los votos permanecen ocultos hasta que todos participen.',
      revelada: sesion.votos_recibidos === sesion.total_participantes
        ? 'Todos votaron. Los puntos se revelaron al mismo tiempo.'
        : 'Ronda revelada. Los participantes pendientes quedaron registrados como Sin voto.',
      cerrada: `Estimación final guardada: ${sesion.valor_final} puntos${sesion.cierre_automatico ? ' (calculada automáticamente en la cuarta ronda)' : ''}.`,
    };
    $('pp-estado-ronda').textContent = estados[sesion.estado] ?? 'Estado de ronda desconocido.';
    $('pp-numero-ronda').textContent = `Ronda ${sesion.ronda}`;
    $('pp-conteo').textContent = `${sesion.votos_recibidos} de ${sesion.total_participantes} votos recibidos`;
    const avisos = [];
    if (sesion.estado !== 'votando') {
      if (sesion.sin_voto?.length) avisos.push(`Sin voto: ${sesion.sin_voto.join(', ')}.`);
      if (sesion.recomendar_discusion) avisos.push(`Diferencia de ${sesion.diferencia} puntos: se recomienda discutir y votar de nuevo.`);
      else if (sesion.consenso) avisos.push('Todos coincidieron en la estimación.');
      else if (sesion.estado === 'revelada') avisos.push('No hubo consenso completo; pueden discutir y repetir la ronda.');
    }
    if (sesion.estado === 'revelada' && sesion.ronda === 3 && !sesion.consenso) {
      avisos.push('Queda una ronda. En la cuarta se calcularán los puntos finales automáticamente.');
    }
    $('pp-diagnostico').textContent = avisos.join(' ');

    const contenedor = $('pp-participantes');
    contenedor.replaceChildren();
    for (const p of sesion.participantes) {
      const item = document.createElement('div');
      item.className = 'pp-participante';
      const nombre = document.createElement('span');
      nombre.textContent = p.nombre;
      const estado = document.createElement('small');
      estado.textContent = sesion.estado === 'votando'
        ? (p.ha_votado ? '✓ Votó' : 'Pendiente')
        : (p.ha_votado ? `${p.puntos} pts` : 'Sin voto');
      item.append(nombre, estado);
      contenedor.append(item);
    }
  }
  for (const boton of $('pp-cartas-voto').querySelectorAll('[data-voto]')) {
    boton.disabled = !sesion || sesion.estado !== 'votando' || procesandoRonda || !['developer', 'scrum_master', 'product_owner'].includes(rolActual());
    boton.setAttribute('aria-pressed', String(sesion?.mi_voto === Number(boton.dataset.voto)));
  }
  $('pp-aviso-voto').textContent = sesion?.mi_voto
    ? `Tu voto: ${sesion.mi_voto} puntos. ${sesion.estado === 'votando' ? 'Puedes cambiarlo mientras la ronda siga abierta.' : 'La ronda ya terminó.'}`
    : 'Elige una carta. Los demás no verán tu valor hasta revelar la ronda.';
  const puedeFinalizar = Boolean(sesion && sesion.estado === 'revelada' && permisoModerador);
  $('pp-final-panel').hidden = !puedeFinalizar;
  $('pp-revelar').hidden = !sesion || sesion.estado !== 'votando' || !permisoModerador;
  $('pp-revelar').disabled = procesandoRonda || !sesion?.votos_recibidos || sesion.votos_recibidos === sesion.total_participantes;
  if (!sesion) $('pp-diagnostico').textContent = '';
  $('pp-otra-ronda').disabled = procesandoRonda || !sesion || sesion.ronda >= 4;
  $('pp-otra-ronda').textContent = sesion?.ronda === 3 ? 'Iniciar cuarta ronda' : 'Votar de nuevo';
  $('pp-fijar').disabled = procesandoRonda || !$('pp-valor-final').value;
}

async function cargarRonda() {
  const historia = historiaActual();
  if (!historia || !proyectoId) {
    sesionPoker = null;
    pintarRonda();
    return;
  }
  try {
    const datos = await api(`${rutaRonda(historia.id)}/ronda`);
    // No pintar una respuesta tardía de la historia que ya se cambió.
    if (String(historiaActual()?.id) !== String(historia.id)) return;
    sesionPoker = datos.sesion ?? null;
    pintarRonda();
  } catch (error) {
    avisar(error.cuerpo?.mensaje || error.message || 'No se pudo consultar la ronda.');
  }
}

async function ejecutarRonda(ruta, cuerpo) {
  if (procesandoRonda) return;
  procesandoRonda = true;
  pintarRonda();
  try {
    const datos = await api(ruta, { metodo: 'POST', cuerpo });
    sesionPoker = datos.sesion ?? null;
    pintarRonda();
    if (sesionPoker?.estado === 'cerrada') {
      await cargarHistorias();
      await cargarRonda();
      avisar(sesionPoker?.cierre_automatico ? 'Cuarta ronda finalizada: se guardó la estimación Fibonacci calculada a partir de los votos recibidos.' : 'Estimación final guardada. Ya aparece en el Product Backlog.', 'exito');
    }
  } catch (error) {
    avisar(error.cuerpo?.mensaje || error.message || 'No se pudo realizar la operación.');
    await cargarRonda();
  } finally {
    procesandoRonda = false;
    pintarRonda();
  }
}

$('pp-historia').addEventListener('change', () => {
  sesionPoker = null;
  $('pp-valor-final').value = '';
  cargarRonda();
});
$('pp-actualizar').addEventListener('click', () => cargarRonda());
$('pp-iniciar').addEventListener('click', () => {
  const h = historiaActual();
  if (h && permisoModerador) ejecutarRonda(`${rutaRonda(h.id)}/ronda`);
});
$('pp-cartas-voto').addEventListener('click', (evento) => {
  const boton = evento.target.closest('[data-voto]');
  const h = historiaActual();
  if (h && boton && !boton.disabled) ejecutarRonda(`${rutaRonda(h.id)}/voto`, { puntos: Number(boton.dataset.voto) });
});
$('pp-valor-final').addEventListener('change', pintarRonda);
// Confirmación propia de la página: no utilizar confirm() nativo del navegador.
const modalRevelar = $('pp-modal-revelar');
let historiaPendienteRevelar = null;
function cerrarModalRevelar() {
  modalRevelar.hidden = true;
  historiaPendienteRevelar = null;
  $('pp-revelar').focus();
}
$('pp-revelar').addEventListener('click', () => {
  const h = historiaActual();
  if (!h || !permisoModerador || !sesionPoker?.votos_recibidos || sesionPoker.estado !== 'votando') return;
  historiaPendienteRevelar = h.id;
  $('pp-modal-revelar').hidden = false;
  $('pp-modal-confirmar').focus();
});
$('pp-modal-cancelar').addEventListener('click', cerrarModalRevelar);
$('pp-modal-cerrar').addEventListener('click', cerrarModalRevelar);
modalRevelar.addEventListener('click', (evento) => {
  if (evento.target === modalRevelar) cerrarModalRevelar();
});
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && !modalRevelar.hidden) cerrarModalRevelar();
});
$('pp-modal-confirmar').addEventListener('click', () => {
  const id = historiaPendienteRevelar;
  cerrarModalRevelar();
  if (id && String(historiaActual()?.id) === String(id) && permisoModerador) {
    ejecutarRonda(`${rutaRonda(id)}/revelar`);
  }
});
$('pp-otra-ronda').addEventListener('click', () => {
  const h = historiaActual();
  if (h && permisoModerador) {
    $('pp-valor-final').value = '';
    ejecutarRonda(`${rutaRonda(h.id)}/nueva-ronda`);
  }
});
$('pp-fijar').addEventListener('click', () => {
  const h = historiaActual();
  const puntos = Number($('pp-valor-final').value);
  if (h && permisoModerador && [1, 2, 3, 5, 8, 13, 21].includes(puntos)) {
    ejecutarRonda(`${rutaRonda(h.id)}/cerrar`, { puntos });
  }
});

// Socket.IO informa del cambio sin exponer los votos secretos.
if (proyectoId && typeof window.io === 'function') {
  const socketPoker = window.io({ withCredentials: true });
  socketPoker.on('connect', () => socketPoker.emit('unirse_proyecto', Number(proyectoId)));
  socketPoker.on('poker:actualizado', (evento) => {
    if (String(evento?.proyecto_id) === String(proyectoId)
        && String(evento?.historia_id) === String(historiaActual()?.id)) cargarRonda();
  });
  socketPoker.on('story:updated', async () => { await cargarHistorias(); await cargarRonda(); });
}
// Respaldo si un navegador no tiene conexión WebSocket activa.
if (proyectoId) setInterval(() => {
  if (!document.hidden && !procesandoRonda) cargarRonda();
}, 5000);
