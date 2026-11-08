/**
 * @file perfil.js
 * @description Lógica de la pantalla de perfil: información del usuario, seguridad (2FA), preferencias y gestión de cuenta.
 * 
 * @author Citlaly Morales Viveros
 */

import { api } from '../core/api.js';
import { escaparHtml } from '../core/utils.js';

// Funciones temporales para que el sistema no colapse al mostrar notificaciones
function mostrarAviso(mensaje, tipo = 'info') {
  alert(mensaje);
}

function mostrarError(mensaje) {
  alert('Error: ' + mensaje);
}

/**
 * Obtener el mensaje que envió el servidor en una respuesta de error de api().
 * api() lanza un Error cuyo mensaje es solo "HTTP <estado>"; el texto útil viene en error.cuerpo.
 *
 * @param {Error & {cuerpo?: Object}} error - Error lanzado por api().
 * @param {string} predeterminado - Mensaje a mostrar si el servidor no envió uno.
 * @returns {string} Mensaje para la persona usuaria.
 */
function mensajeDeError(error, predeterminado) {
  const cuerpo = error?.cuerpo;
  const texto = [cuerpo?.mensaje, cuerpo?.error, cuerpo?.message]
    .find((candidato) => typeof candidato === 'string' && candidato.trim());
  return texto || predeterminado;
}

/**
 * Obtener las iniciales del nombre del usuario para mostrar en el avatar.
 * @param {string} nombre - Nombre completo del usuario.
 * @returns {string} Iniciales (2 letras max).
 */
function obtenerIniciales(nombre) {
  if (!nombre) return '?';
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  if (palabras.length === 1) return palabras[0].charAt(0).toUpperCase();
  return (palabras[0].charAt(0) + palabras[palabras.length - 1].charAt(0)).toUpperCase();
}

/**
 * Cargar información del usuario y actualizar el encabezado del perfil.
 */
async function cargarInformacionUsuario() {
  try {
    const respuesta = await api('/capacidad/yo');
    const usuario = respuesta.usuario ?? respuesta.data?.usuario;

    const avatar = document.getElementById('perfil-avatar');
    const nombre = document.getElementById('perfil-nombre');
    const correo = document.getElementById('perfil-correo');

    if (avatar) avatar.textContent = obtenerIniciales(usuario.nombre);
    if (nombre) nombre.textContent = escaparHtml(usuario.nombre);
    if (correo) correo.textContent = escaparHtml(usuario.correo);
  } catch (error) {
    console.error('[perfil] Error al cargar información del usuario:', error);
    const nombre = document.getElementById('perfil-nombre');
    const correo = document.getElementById('perfil-correo');
    if (nombre) nombre.textContent = 'Usuario';
    if (correo) correo.textContent = 'Cargando...';
  }
}

/**
 * Cambiar la seccion activa en el perfil.
 * @param {string} seccion - Identificador de la seccion a mostrar.
 */
function mostrarSeccion(seccion) {
  document.querySelectorAll('.perfil-seccion').forEach(s => s.classList.remove('activa'));
  document.querySelectorAll('.perfil-enlace').forEach(enlace => enlace.classList.remove('activo'));

  const seccionElemento = document.getElementById(`seccion-${seccion}`);
  if (seccionElemento) seccionElemento.classList.add('activa');

  const enlaceActivo = document.querySelector(`[data-seccion="${seccion}"]`);
  if (enlaceActivo) enlaceActivo.classList.add('activo');

  if (seccion === 'seguridad') cargarSeccionSeguridad();
}

/**
 * Configurar la navegacion entre secciones del perfil.
 */
function configurarNavegacion() {
  document.querySelectorAll('.perfil-enlace').forEach(enlace => {
    enlace.addEventListener('click', (e) => {
      e.preventDefault();
      const seccion = enlace.getAttribute('data-seccion');
      mostrarSeccion(seccion);
      history.pushState(null, '', `#${seccion}`);
    });
  });

  window.addEventListener('popstate', () => {
    const hash = window.location.hash.substring(1);
    mostrarSeccion(hash || 'perfil');
  });

  const hash = window.location.hash.substring(1);
  if (hash) mostrarSeccion(hash);
}

/**
 * Estado actual de 2FA del usuario.
 */
let estado2FA = {
  habilitado: false,
  metodos: { totp: { activado: false }, correo: { activado: false } },
  codigosRespaldo: { generados: false, total: 0, restantes: 0 },
  dispositivosConfianza: 0,
  recuperacion: null
};

/**
 * Cargar la seccion de Seguridad con la configuracion de 2FA.
 */
async function cargarSeccionSeguridad() {
  const contenedor = document.getElementById('contenido-seguridad');
  if (!contenedor) return;

  try {
    const respuesta = await api('/usuarios/2fa/estado');
    estado2FA = respuesta;
    const codigosRestantes = Number(estado2FA.codigosRespaldo?.restantes) || 0;

    contenedor.innerHTML = `
      <div class="2fa-contenedor">
        <!-- Estado general de 2FA -->
        <div class="tarjeta tarjeta--seguridad" style="margin-bottom: 1.5rem;">
          <div class="tarjeta__cuerpo">
            <h3 style="margin: 0 0 0.5rem 0;">Autenticación en Dos Pasos</h3>
            <p style="color: var(--color-texto-secundario); margin: 0 0 1rem 0; font-size: 0.9rem;">
              ${estado2FA.habilitado
        ? 'El 2FA está activado en tu cuenta. Se requerirá un código adicional al iniciar sesión.'
        : 'El 2FA no está activado en tu cuenta. Actívalo para mayor seguridad.'}
            </p>
            
            <div class="2fa-estado" style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
              <span style="font-weight: 500;">Estado: ${estado2FA.habilitado ? 'Activado' : 'Desactivado'}</span>
              <label class="interruptor">
                <input type="checkbox" id="toggle-2fa" ${estado2FA.habilitado ? 'checked' : ''}>
                <span class="interruptor-deslizante"></span>
              </label>
            </div>

            ${estado2FA.habilitado ? `
              <div class="aviso aviso--exito" style="margin-top: 1rem;">
                <p style="margin: 0;"><strong>2FA Activado:</strong> Tu cuenta está protegida con autenticación en dos pasos.</p>
              </div>
            ` : `
              <div class="aviso aviso--advertencia" style="margin-top: 1rem;">
                <p style="margin: 0;">Para activar el 2FA, debes configurar al menos un método de autenticación.</p>
              </div>
            `}

            ${estado2FA.recuperacion ? `
              <div class="aviso aviso--peligro" style="margin-top: 1.5rem; margin-bottom: 1.5rem; border: 2px solid #dc3545;">
                  <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                      <div>
                          <h4 style="margin: 0 0 0.5rem 0; color: #721c24;">¡Recuperación de cuenta en proceso!</h4>
                          <p style="margin: 0; font-size: 0.9rem; color: #721c24;">Se solicitó recuperar el acceso a esta cuenta el ${new Date(estado2FA.recuperacion.solicitado_en).toLocaleString()}. Si no fuiste tú, cancela la solicitud inmediatamente.</p>
                      </div>
                      <button class="boton boton--peligro boton--pequeno" id="btn-cancelar-recuperacion-perfil">Cancelar solicitud</button>
                  </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Metodos de autenticacion -->
        <div class="2fa-metodos" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <!-- Google Authenticator -->
          <div class="tarjeta">
            <div class="tarjeta__cabecera" style="display: flex; align-items: center; gap: 0.5rem;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="2" width="20" height="20" rx="2" ry="2"/>
                <path d="M12 7v10"/><path d="M7 12h10"/>
              </svg>
              <h3 style="margin: 0;">Google Authenticator</h3>
            </div>
            <div class="tarjeta__cuerpo">
              <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-texto-secundario);">
                Genera códigos de 6 dígitos desde tu aplicación móvil.
              </p>
              
              ${estado2FA.metodos.totp.activado ? `
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
                  <span class="insignia insignia--exito">Activado</span>
                  <span style="font-size: 0.8rem; color: var(--color-texto-secundario);">
                    ${estado2FA.metodos.totp.activadoEn ? new Date(estado2FA.metodos.totp.activadoEn).toLocaleDateString() : ''}
                  </span>
                </div>
                <button class="boton boton--secundario boton--pequeno" id="btn-desactivar-totp" style="margin-right: 0.5rem;">Desactivar</button>
              ` : `<button class="boton boton--primario boton--pequeno" id="btn-activar-totp">Configurar</button>`}
            </div>
          </div>

          <!-- Correo electronico -->
          <div class="tarjeta">
            <div class="tarjeta__cabecera" style="display: flex; align-items: center; gap: 0.5rem;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <path d="M22 6l-10 7L2 6"/>
              </svg>
              <h3 style="margin: 0;">Código por Correo</h3>
            </div>
            <div class="tarjeta__cuerpo">
              <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-texto-secundario);">
                Recibe un código de 6 dígitos en tu correo electrónico.
              </p>
              
              ${estado2FA.metodos.correo.activado ? `
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
                  <span class="insignia insignia--exito">Activado</span>
                  <span style="font-size: 0.8rem; color: var(--color-texto-secundario);">
                    ${estado2FA.metodos.correo.activadoEn ? new Date(estado2FA.metodos.correo.activadoEn).toLocaleDateString() : ''}
                  </span>
                </div>
                <button class="boton boton--secundario boton--pequeno" id="btn-desactivar-correo">Desactivar</button>
              ` : `<button class="boton boton--primario boton--pequeno" id="btn-activar-correo">Activar</button>`}
            </div>
          </div>
        </div>

        <!-- Códigos de respaldo -->
        <div class="tarjeta" style="margin-bottom: 1.5rem;">
          <div class="tarjeta__cabecera"><h3 style="margin: 0;">Códigos de Respaldo</h3></div>
          <div class="tarjeta__cuerpo">
            <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-texto-secundario);">
              Úsalos si pierdes acceso a tus métodos de autenticación. Cada código solo puede usarse una vez.
            </p>
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
              <span>Códigos disponibles: ${codigosRestantes}</span>
              ${estado2FA.codigosRespaldo?.generados && codigosRestantes === 0 ? `
                <span style="font-size: 0.85rem; color: var(--color-texto-secundario);">Ya usaste todos tus códigos. Genera nuevos.</span>
              ` : ''}
            </div>
            
            ${codigosRestantes > 0 ? `
              <button class="boton boton--peligro boton--pequeno" id="btn-regenerar-respaldo">Regenerar</button>
            ` : `
              <button class="boton boton--primario boton--pequeno" id="btn-generar-respaldo">Generar Códigos</button>
            `}
          </div>
        </div>

        <!-- Dispositivos de confianza -->
        <div class="tarjeta">
          <div class="tarjeta__cabecera"><h3 style="margin: 0;">Dispositivos de Confianza</h3></div>
          <div class="tarjeta__cuerpo">
            <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--color-texto-secundario);">
              Dispositivos donde puedes omitir el 2FA durante 14 días.
            </p>
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
              <span>Dispositivos registrados: ${estado2FA.dispositivosConfianza}</span>
            </div>
            <button class="boton boton--primario boton--pequeno" id="btn-registrar-dispositivo">Registrar este dispositivo</button>
            ${estado2FA.dispositivosConfianza > 0 ? `
              <button class="boton boton--secundario boton--pequeno" id="btn-ver-dispositivos" style="margin-left: 0.5rem;">Ver dispositivos</button>
              <button class="boton boton--peligro boton--pequeno" id="btn-revocar-todos-dispositivos" style="margin-left: 0.5rem;">Revocar todos</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    configurarEventosSeguridad();
  } catch (error) {
    console.error('[perfil] Error al cargar seccion de seguridad:', error);
    contenedor.innerHTML = `
      <div class="aviso aviso--error">
        <p>Error al cargar la configuración de seguridad. Inténtalo de nuevo más tarde.</p>
      </div>
    `;
  }
}

/**
 * Configurar eventos de los botones de la seccion de seguridad.
 */
function configurarEventosSeguridad() {
  const toggle2FA = document.getElementById('toggle-2fa');
  if (toggle2FA) {
    toggle2FA.addEventListener('change', async (e) => {
      const habilitar = e.target.checked;
      if (habilitar) {
        if (!estado2FA.metodos.totp.activado && !estado2FA.metodos.correo.activado) {
          e.target.checked = false;
          mostrarError('Para activar el 2FA, debes configurar al menos un método de autenticación.');
          return;
        }
        const password = await solicitarPassword('Ingresa tu contraseña para activar el 2FA.');
        if (!password) { e.target.checked = false; return; }
        try {
          await api('/usuarios/2fa/habilitar', { metodo: 'POST', cuerpo: { password } });
          mostrarAviso('2FA activado correctamente.', 'exito');
          estado2FA.habilitado = true;
        } catch (error) {
          e.target.checked = false;
          mostrarError(mensajeDeError(error, 'Error al activar el 2FA.'));
        }
      } else {
        const password = prompt('Ingresa tu contraseña para desactivar el 2FA:');
        if (!password) { e.target.checked = true; return; }
        try {
          await api('/usuarios/2fa/deshabilitar', { metodo: 'POST', cuerpo: { password } });
          mostrarAviso('2FA desactivado correctamente.', 'exito');
          estado2FA.habilitado = false;
        } catch (error) {
          e.target.checked = true;
          mostrarError(mensajeDeError(error, 'Error al desactivar el 2FA.'));
        }
      }
    });
  }

  // Configurar TOTP

  const btnActivarTotp = document.getElementById('btn-activar-totp');
  if (btnActivarTotp) btnActivarTotp.addEventListener('click', iniciarConfiguracionTotp);

  // Desactivar TOTP
  const btnDesactivarTotp = document.getElementById('btn-desactivar-totp');
  if (btnDesactivarTotp) {
    btnDesactivarTotp.addEventListener('click', async () => {
      const confirmar = confirm('¿Estás seguro de que quieres desactivar Google Authenticator?');
      if (!confirmar) return;
      const password = prompt('Ingresa tu contraseña para confirmar:');
      if (!password) return;
      try {
        await api('/usuarios/2fa/totp/desactivar', { metodo: 'POST', cuerpo: { password } });
        mostrarAviso('Google Authenticator desactivado correctamente.', 'exito');
        estado2FA.metodos.totp.activado = false;
        cargarSeccionSeguridad();
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al desactivar Google Authenticator.'));
      }
    });
  }

  // Activar/Desactivar correo
  const btnActivarCorreo = document.getElementById('btn-activar-correo');
  if (btnActivarCorreo) {
    btnActivarCorreo.addEventListener('click', async () => {
      const password = await solicitarPassword('Ingresa tu contraseña para activar el código por correo.');
      if (!password) return;
      try {
        const solicitud = await api('/usuarios/2fa/correo/activar', { metodo: 'POST', cuerpo: { password } });
        if (!solicitud.pendienteVerificacion) { cargarSeccionSeguridad(); return; }
        const resultado = await pedirCodigoCorreo((codigo) => api('/usuarios/2fa/correo/confirmar', { metodo: 'POST', cuerpo: { codigo } }));
        if (!resultado) { mostrarAviso('Activación cancelada. El código por correo no quedó activado.', 'info'); return; }
        estado2FA.metodos.correo.activado = true;
        estado2FA.metodos.correo.activadoEn = new Date().toISOString();
        cargarSeccionSeguridad();
        avisarActivacionDeMetodo(resultado, 'Código por correo activado correctamente. Recibirás un código en tu próxima autenticación.');
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al activar código por correo.'));
      }
    });
  }

  const btnDesactivarCorreo = document.getElementById('btn-desactivar-correo');
  if (btnDesactivarCorreo) {
    btnDesactivarCorreo.addEventListener('click', async () => {
      const confirmar = confirm('¿Estás seguro de que quieres desactivar el código por correo?');
      if (!confirmar) return;
      const password = prompt('Ingresa tu contraseña para confirmar:');
      if (!password) return;
      try {
        await api('/usuarios/2fa/correo/desactivar', { metodo: 'POST', cuerpo: { password } });
        mostrarAviso('Código por correo desactivado correctamente.', 'exito');
        estado2FA.metodos.correo.activado = false;
        cargarSeccionSeguridad();
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al desactivar código por correo.'));
      }
    });
  }

  const btnGenerarRespaldo = document.getElementById('btn-generar-respaldo');
  if (btnGenerarRespaldo) btnGenerarRespaldo.addEventListener('click', generarCodigosRespaldo);

  const btnRegenerarRespaldo = document.getElementById('btn-regenerar-respaldo');
  if (btnRegenerarRespaldo) {
    btnRegenerarRespaldo.addEventListener('click', () => {
      const confirmar = confirm('¿Estás seguro de que quieres regenerar los códigos de respaldo? Los códigos actuales dejarán de funcionar.');
      if (confirmar) generarCodigosRespaldo();
    });
  }

  const btnRegistrarDispositivo = document.getElementById('btn-registrar-dispositivo');
  if (btnRegistrarDispositivo) btnRegistrarDispositivo.addEventListener('click', registrarDispositivoConfianza);

  const btnVerDispositivos = document.getElementById('btn-ver-dispositivos');
  if (btnVerDispositivos) btnVerDispositivos.addEventListener('click', listarDispositivosConfianza);

  const btnRevocarTodosDispositivos = document.getElementById('btn-revocar-todos-dispositivos');
  if (btnRevocarTodosDispositivos) {
    btnRevocarTodosDispositivos.addEventListener('click', async () => {
      const confirmar = confirm('¿Estás seguro de que quieres revocar TODOS los dispositivos de confianza?');
      if (!confirmar) return;
      const password = prompt('Ingresa tu contraseña para confirmar:');
      if (!password) return;
      try {
        await api('/usuarios/2fa/dispositivos/revocar-todos', { metodo: 'POST', cuerpo: { password } });
        mostrarAviso('Todos los dispositivos de confianza han sido revocados.', 'exito');
        estado2FA.dispositivosConfianza = 0;
        cargarSeccionSeguridad();
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al revocar dispositivos.'));
      }
    });
  }

  const btnCancelarRecuperacion = document.getElementById('btn-cancelar-recuperacion-perfil');
  if (btnCancelarRecuperacion) {
    btnCancelarRecuperacion.addEventListener('click', async () => {
      const confirmar = confirm('¿Estás seguro de que quieres cancelar la recuperación de cuenta en curso?');
      if (!confirmar) return;
      try {
        await api('/usuarios/2fa/recuperar/cancelar', { metodo: 'POST', cuerpo: {} });
        mostrarAviso('Recuperación cancelada correctamente. Tu cuenta está segura.', 'exito');
        cargarSeccionSeguridad();
      } catch (error) {
        mostrarError(mensajeDeError(error, 'Error al cancelar la recuperación.'));
      }
    });
  }
}

function solicitarPassword(mensaje) {
  return new Promise((resolver) => {
    const overlay = document.getElementById('modal-password-overlay');
    const texto = document.getElementById('modal-password-mensaje');
    const input = document.getElementById('modal-password-input');
    const btnAceptar = document.getElementById('btn-aceptar-password');
    const btnCancelar = document.getElementById('btn-cancelar-password');

    if (!overlay || !texto || !input || !btnAceptar || !btnCancelar) return resolver(null);

    const cerrar = (valor) => {
      overlay.classList.add('modal--hidden');
      document.body.style.overflow = '';
      input.value = '';
      resolver(valor);
    };

    btnAceptar.onclick = () => { if (!input.value) input.focus(); else cerrar(input.value); };
    btnCancelar.onclick = () => cerrar(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btnAceptar.onclick(); } };

    texto.textContent = mensaje;
    input.value = '';
    overlay.classList.remove('modal--hidden');
    document.body.style.overflow = 'hidden';
    input.focus();
  });
}

function pedirCodigoCorreo(verificar) {
  return new Promise((resolver) => {
    const overlay = document.getElementById('modal-correo-overlay');
    const input = document.getElementById('codigo-correo-verificar');
    const error = document.getElementById('modal-correo-error');
    const btnConfirmar = document.getElementById('btn-confirmar-correo');
    const btnCancelar = document.getElementById('btn-cancelar-correo');

    if (!overlay || !input || !error || !btnConfirmar || !btnCancelar) return resolver(null);

    const cerrar = (valor) => {
      overlay.classList.add('modal--hidden');
      document.body.style.overflow = '';
      input.value = '';
      error.textContent = '';
      resolver(valor);
    };

    const confirmar = async () => {
      const codigo = input.value.trim();
      if (!/^\d{6}$/.test(codigo)) { error.textContent = 'El código debe tener 6 dígitos.'; return; }
      btnConfirmar.disabled = true;
      error.textContent = '';
      try {
        cerrar(await verificar(codigo));
      } catch (fallo) {
        error.textContent = mensajeDeError(fallo, 'Código inválido. Inténtalo de nuevo.');
        input.value = '';
        input.focus();
      } finally {
        btnConfirmar.disabled = false;
      }
    };

    btnConfirmar.onclick = confirmar;
    btnCancelar.onclick = () => cerrar(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } };

    input.value = '';
    error.textContent = '';
    overlay.classList.remove('modal--hidden');
    document.body.style.overflow = 'hidden';
    input.focus();
  });
}

function mostrarModalCodigosRespaldo(codigos) {
  const overlay = document.getElementById('modal-respaldo-overlay');
  const contenedor = document.getElementById('modal-respaldo-codigos');
  if (!overlay || !contenedor) return;

  contenedor.innerHTML = codigos.map((codigo, index) => `
    <div class="tarjeta" style="padding: 0.75rem; text-align: center; font-family: monospace; font-size: 0.875rem;">
      <code style="font-size: 1.1rem; letter-spacing: 0.2rem;">${escaparHtml(codigo)}</code>
      <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--color-texto-secundario);">#${index + 1}</div>
    </div>
  `).join('');

  overlay.classList.remove('modal--hidden');
  document.body.style.overflow = 'hidden';
}

function configurarModalRespaldo() {
  const overlay = document.getElementById('modal-respaldo-overlay');
  if (!overlay) return;

  const obtenerCodigos = () => Array.from(document.querySelectorAll('#modal-respaldo-codigos code')).map(e => e.textContent);

  const btnCopiar = document.getElementById('btn-copiar-respaldo');
  if (btnCopiar) {
    btnCopiar.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(obtenerCodigos().join('\n'));
        mostrarAviso('Códigos copiados al portapapeles.', 'exito');
      } catch (error) {
        mostrarError('No se pudieron copiar los códigos. Descárgalos o cópialos a mano.');
      }
    });
  }

  const btnDescargar = document.getElementById('btn-descargar-respaldo');
  if (btnDescargar) {
    btnDescargar.addEventListener('click', () => {
      const lineas = obtenerCodigos().map((codigo, index) => `${index + 1}. ${codigo}`);
      const contenido = ['Códigos de respaldo de ScrumFlow', 'Cada código solo puede usarse una vez.', '', ...lineas, ''].join('\r\n');
      const url = URL.createObjectURL(new Blob([contenido], { type: 'text/plain;charset=utf-8' }));
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'codigos-respaldo-scrumflow.txt';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    });
  }

  const btnCerrar = document.getElementById('btn-cerrar-respaldo');
  if (btnCerrar) {
    btnCerrar.addEventListener('click', () => {
      overlay.classList.add('modal--hidden');
      document.body.style.overflow = '';
    });
  }
}

function avisarActivacionDeMetodo(resultado, mensajeMetodo) {
  if (!resultado?.activadoAutomaticamente) {
    mostrarAviso(mensajeMetodo, 'exito');
    return;
  }
  estado2FA.habilitado = true;
  mostrarAviso(`${mensajeMetodo} El 2FA quedó activado en tu cuenta.`, 'exito');
  if (Array.isArray(resultado.codigos) && resultado.codigos.length > 0) {
    mostrarModalCodigosRespaldo(resultado.codigos);
  } else {
    mostrarAviso('No se pudieron generar tus códigos de respaldo. Genéralos desde la sección de seguridad antes de cerrar sesión.', 'advertencia');
  }
}

async function iniciarConfiguracionTotp() {
  const password = await solicitarPassword('Ingresa tu contraseña para configurar Google Authenticator.');
  if (!password) return;

  try {
    const respuesta = await api('/usuarios/2fa/totp/iniciar', { metodo: 'POST', cuerpo: { password } });
    const { secreto, qr } = respuesta;

    const modal = document.getElementById('modal-totp');
    const overlay = document.getElementById('modal-totp-overlay');
    const modalTitulo = document.getElementById('modal-totp-titulo');
    const modalDescripcion = document.getElementById('modal-totp-descripcion');
    const modalQr = document.getElementById('modal-totp-qr');
    const modalSecreto = document.getElementById('modal-totp-secreto');

    if (modal && overlay) {
      modalTitulo.textContent = 'Configurar Google Authenticator';
      modalDescripcion.textContent = 'Escanea este código QR con tu aplicación de autenticación (Google Authenticator, Authy, etc.)';
      modalQr.innerHTML = qr;
      modalQr.setAttribute('role', 'img');
      modalQr.setAttribute('aria-label', 'Código QR para Google Authenticator');
      modalSecreto.textContent = secreto;

      overlay.classList.remove('modal--hidden');
      document.body.style.overflow = 'hidden';
    }

    const btnConfirmar = document.getElementById('btn-confirmar-totp');
    const btnCancelar = document.getElementById('btn-cancelar-totp');

    if (btnConfirmar && btnCancelar) {
      const confirmarAccion = async () => {
        const codigoInput = document.getElementById('codigo-totp-verificar');
        const codigo = codigoInput?.value?.trim();

        if (!codigo || codigo.length !== 6) { mostrarError('El código debe tener 6 dígitos.'); return; }

        try {
          const resultado = await api('/usuarios/2fa/totp/confirmar', { metodo: 'POST', cuerpo: { codigo } });
          if (overlay) { overlay.classList.add('modal--hidden'); document.body.style.overflow = ''; }
          estado2FA.metodos.totp.activado = true;
          estado2FA.metodos.totp.activadoEn = new Date().toISOString();
          cargarSeccionSeguridad();
          avisarActivacionDeMetodo(resultado, 'Google Authenticator configurado correctamente.');
        } catch (error) {
          mostrarError(mensajeDeError(error, 'Código inválido. Inténtalo de nuevo.'));
          codigoInput.value = '';
          codigoInput.focus();
        }
      };

      btnConfirmar.onclick = async () => await confirmarAccion();
      btnCancelar.onclick = () => { if (overlay) { overlay.classList.add('modal--hidden'); document.body.style.overflow = ''; } };

      const codigoInput = document.getElementById('codigo-totp-verificar');
      if (codigoInput) {
        codigoInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarAccion(); } });
      }
    }
  } catch (error) {
    mostrarError(mensajeDeError(error, 'Error al iniciar configuración de Google Authenticator.'));
  }
}

async function generarCodigosRespaldo() {
  const password = await solicitarPassword('Ingresa tu contraseña para generar nuevos códigos de respaldo.');
  if (!password) return;

  try {
    const respuesta = await api('/usuarios/2fa/respaldo/generar', { metodo: 'POST', cuerpo: { password } });
    const { codigos } = respuesta;
    const modal = document.getElementById('modal-respaldo');
    const contenedorCodigos = document.getElementById('modal-respaldo-codigos');
    const overlay = document.getElementById('modal-respaldo-overlay');

    if (modal && overlay && contenedorCodigos) {
      contenedorCodigos.innerHTML = codigos.map((codigo, index) => `
        <div class="tarjeta" style="padding: 0.75rem; text-align: center; font-family: monospace; font-size: 0.875rem;">
          <code style="font-size: 1.1rem; letter-spacing: 0.2rem;">${codigo}</code>
          <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--color-texto-secundario);">#${index + 1}</div>
        </div>
      `).join('');

      overlay.classList.remove('modal--hidden');
      document.body.style.overflow = 'hidden';
      estado2FA.codigosRespaldo.generados = true;
      estado2FA.codigosRespaldo.restantes = codigos.length;

      const btnCerrar = document.getElementById('btn-cerrar-respaldo');
      if (btnCerrar) btnCerrar.onclick = () => { overlay.classList.add('modal--hidden'); document.body.style.overflow = ''; };
    }
    cargarSeccionSeguridad();
    mostrarAviso('Códigos de respaldo generados correctamente. Guárdalos en un lugar seguro.', 'exito');

  } catch (error) {
    mostrarError(mensajeDeError(error, 'Error al generar códigos de respaldo.'));
  }
}

/**
 * Registrar el dispositivo actual como de confianza.
 */
async function registrarDispositivoConfianza() {
  const password = await solicitarPassword('Ingresa tu contraseña para registrar este dispositivo como de confianza.');
  if (!password) return;
  try {
    const nombre = prompt('Ingresa un nombre para este dispositivo (opcional, ej: "Mi PC", "Laptop Trabajo"):');
    await api('/usuarios/2fa/dispositivos/confiar', { metodo: 'POST', cuerpo: { nombre: nombre || null, password } });
    mostrarAviso('Este dispositivo ha sido registrado como de confianza. No se te pedirá el 2FA durante 14 días.', 'exito');
    estado2FA.dispositivosConfianza += 1;
    cargarSeccionSeguridad();

  } catch (error) {
    mostrarError(mensajeDeError(error, 'Error al registrar dispositivo de confianza.'));
  }
}

/**
 * Listar dispositivos de confianza.
 */
async function listarDispositivosConfianza() {
  try {
    const respuesta = await api('/usuarios/2fa/dispositivos');
    const { dispositivos } = respuesta;
    if (dispositivos.length === 0) { mostrarAviso('No tienes dispositivos de confianza registrados.', 'info'); return; }
    const mensaje = dispositivos.map(d => `• ${d.nombre || 'Dispositivo sin nombre'} (${d.ipRegistro}) - ${new Date(d.expiraEn).toLocaleDateString()}`).join('\n');
    alert(`Dispositivos de confianza:\n\n${mensaje}`);

  } catch (error) {
    mostrarError(mensajeDeError(error, 'Error al obtener dispositivos de confianza.'));
  }
}

/**
 * Inicializar el perfil al cargar la pagina.
 */
function init() {
  cargarInformacionUsuario();
  configurarNavegacion();
  configurarModalRespaldo();
}

// Inicializar cuando el DOM este listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Exportar funciones para uso externo (si es necesario)
export { cargarInformacionUsuario, mostrarSeccion, cargarSeccionSeguridad };