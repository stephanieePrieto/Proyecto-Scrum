# Implementación de Autenticación en Dos Pasos (2FA) - ScrumFlow

**Versión:** 1.0  
**Autor:** Citlaly Morales Viveros  
**Fecha:** 2026

## Resumen

Este documento describe la implementación de autenticación en dos pasos (2FA) para el sistema ScrumFlow, siguiendo las decisiones funcionales aprobadas y respetando la arquitectura existente.

---

## Decisiones Implementadas

### Métodos de Autenticación
- **Correo electrónico:** Código OTP de 6 dígitos, válido por 3 minutos
- **Google Authenticator:** TOTP con secreto compartido via código QR
- **Códigos de respaldo:** 10 códigos de un solo uso

### Características
- Múltiples métodos activos simultáneamente
- Opcional para todos los usuarios (no obligatorio)
- Dispositivos de confianza (14 días de validez)
- Bloqueo temporal después de 5 intentos fallidos
- Integración en el perfil existente (no página independiente)
- Reutilización del servicio de correo existente
- Cifrado del secreto TOTP en la base de datos

---

## Arquitectura

### Base de Datos

Se crearon las siguientes tablas (ver `database/migraciones/autenticacion_2fa.sql`):

#### 1. `autenticacion_2fa`
Almacena la configuración general de 2FA por usuario:
- `secreto_totp_cifrado`: Secreto TOTP cifrado (AES-256-GCM)
- `totp_activado`: Si TOTP está configurado
- `correo_2fa_activado`: Si el método por correo está activo
- `habilitado`: Si el 2FA está habilitado globalmente

#### 2. `codigos_respaldo`
Almacena los 10 códigos de respaldo:
- `codigo_hash`: Hash SHA-256 del código
- `usado`: Si el código ya fue utilizado
- `grupo_id`: Para invalidar todos los códigos al regenerar

#### 3. `dispositivos_confianza`
Registra dispositivos que pueden omitir el 2FA:
- `token_confianza`: Token para validar el dispositivo
- `dispositivo_hash`: Hash identificador del dispositivo
- `expira_en`: 14 días después de la creación
- `revocado`: Si fue revocado manualmente

#### 4. `otp_correo`
Códigos OTP enviados por correo:
- `codigo_hash`: Hash SHA-256 del código
- `expira_en`: 3 minutos después de la creación
- `usado`: Si ya fue utilizado

#### 5. `intentos_2fa`
Control de intentos fallidos:
- `intentos`: Contador de intentos fallidos
- `bloqueado_hasta`: Fecha de desbloqueo

---

### Backend

#### Nueva estructura de archivos

```
src/modulos/auth/
├── auth.controller.js    # Modificado: login, logout, renovarToken
├── auth.service.js       # Modificado: autenticarUsuario, funciones de sesión
├── auth.routes.js        # Modificado: rutas existentes
└── 2fa/
    ├── 2fa.controller.js  # Controladores específicos de 2FA
    ├── 2fa.service.js     # Lógica de negocio de 2FA
    ├── 2fa.routes.js      # Rutas de 2FA
    └── 2fa.utils.js       # Utilidades (TOTP, cifrado, etc.)
```

#### Modificaciones a archivos existentes

1. **`auth.controller.js`:**
   - Modificar `login` para devolver token temporal cuando 2FA está activado
   - Modificar `logout` para limpiar tokens temporales

2. **`auth.service.js`:**
   - Añadir `generarTokenTemporal` para el flujo de 2FA
   - Modificar `autenticarUsuario` para verificar si 2FA está activado

3. **`src/config/env.js`:**
   - Añadir nuevas variables de entorno para 2FA

4. **`src/middlewares/autenticar.js`:**
   - Modificar para manejar tokens temporales

---

### Frontend

#### Nuevos archivos

```
public/js/pages/
├── login-2fa.js          # Lógica de verificación 2FA en login

public/pages/
├── login-2fa.html        # Pantalla de verificación 2FA (o integrado en login.html)

public/css/componentes/
├── 2fa.css               # Estilos específicos de 2FA
```

#### Modificaciones a archivos existentes

1. **`login.html`:**
   - Añadir secciones para verificación 2FA
   - Mostrar opciones de método de verificación
   - Campo para ingresar código OTP/TOTP/respaldo

2. **`login.js`:**
   - Modificar flujo de login para manejar respuesta 202 (2FA requerido)
   - Añadir función para redirigir a verificación 2FA

3. **`perfil.html`:**
   - Añadir sección "Seguridad" con configuración de 2FA
   - Mostrar estado actual de 2FA
   - Opciones para activar/desactivar métodos

4. **`perfil.js`:**
   - Añadir funciones para interactuar con endpoints de 2FA
   - Manejar configuración de TOTP (generar QR, confirmar)
   - Manejar generación de códigos de respaldo

5. **`api.js`:**
   - Añadir soporte para tokens temporales

---

## Variables de Entorno

Añadir al archivo `.env`:

```
# Autenticacion en Dos Pasos (2FA)

# Clave de cifrado para secretos TOTP (32 bytes, base64)
# Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
TOTP_ENCRYPTION_KEY=

# Duracion del token temporal de 2FA (minutos)
TOKEN_2FA_TEMPORAL_MINUTOS=15

# Duracion de codigos OTP por correo (minutos)
OTP_CORREO_MINUTOS=3

# Maximo de intentos fallidos de verificacion 2FA
MAX_INTENTOS_2FA=5
```

Actualizar `.env.example` con estos mismos valores (con valores de ejemplo).

---

## Dependencias

No se requieren nuevas dependencias. Se utilizarán:
- `bcryptjs` (ya existe): Para hashing de códigos de respaldo
- `crypto` (Node.js nativo): Para generación de secretos TOTP y cifrado AES
- `nodemailer` (ya existe): Para envío de códigos por correo
- `jsonwebtoken` (ya existe): Para generación de tokens temporales

---

## Implementación de TOTP

Para la generación y verificación de códigos TOTP, se implementará una función basada en el estándar RFC 6238:

### Algoritmo TOTP

```javascript
// Generar código TOTP
function generarTotp(secreto, tiempo = null) {
  const step = 30; // 30 segundos
  const t = Math.floor((tiempo || Date.now()) / (step * 1000));
  const buffer = Buffer.from(t.toString(), 'utf8');
  const hmac = crypto.createHmac('sha1', secreto);
  hmac.update(buffer);
  const hash = hmac.digest();
  const offset = hash[hash.length - 1] & 0x0F;
  const binary = ((hash[offset] & 0x7F) << 24) |
    ((hash[offset + 1] & 0xFF) << 16) |
    ((hash[offset + 2] & 0xFF) << 8) |
    (hash[offset + 3] & 0xFF);
  return (binary % 1_000_000).toString().padStart(6, '0');
}
```

---

## Cifrado del Secreto TOTP

El secreto TOTP se cifrará con AES-256-GCM antes de guardarse en la base de datos:

```javascript
import crypto from 'crypto';

const ALGORITMO = 'aes-256-gcm';

function cifrar(texto, clave) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITMO, clave, iv);
  let cifrado = cipher.update(texto, 'utf8', 'hex');
  cifrado += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${cifrado}:${authTag.toString('hex')}`;
}

function descifrar(textoCifrado, clave) {
  const [ivHex, cifrado, authTagHex] = textoCifrado.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITMO, clave, iv);
  decipher.setAuthTag(authTag);
  let texto = decipher.update(cifrado, 'hex', 'utf8');
  texto += decipher.final('utf8');
  return texto;
}
```

---

## Flujo de Login con 2FA

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cliente       │     │   Servidor       │     │   Base de        │
│                 │     │                 │     │   Datos         │
└─────────┬───────┘     └─────────┬───────┘     └─────────┬───────┘
          │                       │                       │
          │  POST /api/auth/login │                       │
          │  {correo, password}   │                       │
          │──────────────────────>│                       │
          │                       │  Verificar credenciales│
          │                       │──────────────────────>│
          │                       │                       │
          │                       │  2FA activado?         │
          │                       │                       │
          │  202 Accepted         │                       │
          │  {requiere2fa: true,  │                       │
          │   tokenTemporal}      │                       │
          │<──────────────────────│                       │
          │                       │                       │
          │  Mostrar opciones     │                       │
          │  (TOTP/Correo/Respaldo)│                       │
          │                       │                       │
          │  POST /api/2fa/       │                       │
          │  verificar/totp       │                       │
          │  {codigo: "123456"}   │                       │
          │──────────────────────>│                       │
          │                       │  Verificar código     │
          │                       │  con secreto TOTP     │
          │                       │──────────────────────>│
          │                       │                       │
          │  200 OK                │                       │
          │  {accessToken,        │                       │
          │   refreshToken}       │                       │
          │<──────────────────────│                       │
          │                       │                       │
          │  Redirigir a          │                       │
          │  /pages/dashboard.html│                       │
          ▼                       ▼                       ▼
```

---

## Flujo de Configuración de TOTP

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cliente       │     │   Servidor       │     │   Base de        │
└─────────┬───────┘     └─────────┬───────┘     └─────────┬───────┘
          │                       │                       │
          │  GET /api/2fa/totp/    │                       │
          │  iniciar              │                       │
          │──────────────────────>│                       │
          │                       │  Generar secreto TOTP │
          │                       │  Guardar cifrado      │
          │                       │──────────────────────>│
          │                       │                       │
          │  200 OK                │                       │
          │  {secreto, uri, qr}   │                       │
          │<──────────────────────│                       │
          │                       │                       │
          │  Mostrar QR           │                       │
          │  al usuario           │                       │
          │                       │                       │
          │  POST /api/2fa/totp/   │                       │
          │  confirmar            │                       │
          │  {codigo: "123456"}   │                       │
          │──────────────────────>│                       │
          │                       │  Verificar código     │
          │                       │  con secreto temporal│
          │                       │                       │
          │  200 OK                │                       │
          │  {totpActivado: true} │                       │
          │<──────────────────────│                       │
          ▼                       ▼                       ▼
```

---

## Flujo de Recuperación de 2FA

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cliente       │     │   Servidor       │     │   Base de        │
└─────────┬───────┘     └─────────┬───────┘     └─────────┬───────┘
          │                       │                       │
          │  POST /api/2fa/        │                       │
          │  recuperar/solicitar   │                       │
          │  {correo}              │                       │
          │──────────────────────>│                       │
          │                       │  Generar token        │
          │                       │  Enviar por correo    │
          │                       │──────────────────────>│
          │                       │                       │
          │  200 OK                │                       │
          │<──────────────────────│                       │
          │                       │                       │
          │  Usuario hace clic    │                       │
          │  en enlace del correo │                       │
          │                       │                       │
          │  POST /api/2fa/        │                       │
          │  recuperar/verificar   │                       │
          │  {token}              │                       │
          │──────────────────────>│                       │
          │                       │  Verificar token      │
          │                       │  Desactivar 2FA       │
          │                       │  temporalmente        │
          │                       │──────────────────────>│
          │                       │                       │
          │  200 OK                │                       │
          │<──────────────────────│                       │
          │                       │                       │
          │  Redirigir a login    │                       │
          ▼                       ▼                       ▼
```

---

## Manejo de Dispositivos de Confianza

### Flujo de confianza en dispositivo

1. **Iniciar sesión con 2FA** → Verificar correctamente
2. **Opcional:** Marcar la casilla "Confiar en este dispositivo"
3. **Servidor:**
   - Generar `token_confianza` único
   - Calcular `dispositivo_hash` (hash de IP + User-Agent + fingerprint)
   - Guardar en `dispositivos_confianza` con `expira_en = NOW() + 14 days`
   - Devolver `token_confianza` en cookie `tokenConfianza` (httpOnly, 14 días)

4. **Siguientes intentos de login:**
   - Si hay cookie `tokenConfianza` válida:
     - Verificar token en `dispositivos_confianza`
     - Si es válido y no ha expirado: omitir 2FA
     - De lo contrario: solicitar 2FA normalmente

---

## Manejo de Intentos Fallidos

El sistema implementa protección contra fuerza bruta para la verificación de 2FA:

1. **Contador por IP + Usuario:**
   - Cada intento fallido incrementa el contador en `intentos_2fa`
   - Después de 5 intentos fallidos (configurable via `MAX_INTENTOS_2FA`):
     - Bloquear por 15 minutos (usando el valor de `BLOQUEO_MINUTOS`)

2. **Contador por IP:**
   - Usar la tabla `intentos_ip` existente
   - Después de 30 intentos (configurable via `MAX_INTENTOS_IP`):
     - Bloquear por 15 minutos

---

## Consideraciones de Seguridad

### 1. Prevención de Replay Attacks
- Los tokens temporales (`token2faTemporal`) son de un solo uso
- Expiran después de 15 minutos (configurable)
- Se invalidan después de usar o al cerrar sesión

### 2. Prevención de Enumeración de Usuarios
- Siempre devolver el mismo mensaje de error para códigos inválidos
- No revelar si un código parcial es correcto
- Usar el mismo tiempo de respuesta para códigos válidos e inválidos

### 3. Protección de Secretos
- El secreto TOTP siempre se almacena cifrado
- La clave de cifrado NUNCA se almacena en el código fuente
- Usar variable de entorno `TOTP_ENCRYPTION_KEY` de 32 bytes

### 4. Hash de Códigos
- Todos los códigos (OTP, respaldo) se almacenan como hashes SHA-256
- Nunca en texto plano

### 5. Códigos de Respaldo
- Generar 10 códigos alfanuméricos únicos
- Cada código solo puede usarse una vez
- Al regenerar, invalidar todos los códigos del grupo anterior

### 6. No Debilitar Seguridad Existente
- El 2FA es un complemento, no un reemplazo
- Las políticas de contraseñas siguen vigentes
- Las políticas de bloqueo por intentos fallidos siguen vigentes
- Las cookies httpOnly y secure siguen vigentes

---

## Migración de Datos

No se requiere migración de datos existentes. Las nuevas tablas se crean vacías y:
- Los usuarios existentes NO tienen 2FA activado por defecto
- Los usuarios deben activarlo manualmente a través de la interfaz
- No se afecta la autenticación actual de usuarios sin 2FA

## Ejecución de Migración y Permisos

Para implementar la base de datos correctamente:

1. **Ejecuta la migración como scrumflow_admin:**
   ```bash
   psql -U postgres -d scrumflow -v ON_ERROR_STOP=1 -c "SET ROLE scrumflow_admin" -f "./database/migraciones/autenticacion_2fa.sql"
   ```

2. **Otorga permisos a scrumflow_app:**
   ```bash
   psql -U postgres -d scrumflow -v ON_ERROR_STOP=1 -c "SET ROLE scrumflow_admin" -f "./database/permisos_2fa.sql"
   ```

3. **Opcional: También puedes ejecutar permisos_aplicacion.sql para asegurar todos los permisos:**
   ```bash
   psql -U postgres -d scrumflow -v rol_app=scrumflow_app -v rol_propietario=scrumflow_admin -f "./database/permisos_aplicacion.sql"
   ```

**Nota importante:** Las tablas de 2FA fueron creadas DESPUÉS de la ejecución inicial de `permisos_aplicacion.sql`, por lo que necesitas ejecutar `permisos_2fa.sql` para que `scrumflow_app` tenga acceso a ellas.

---

## Pruebas Recomendadas

### Backend
1. Login sin 2FA (usuario existente)
2. Login con 2FA activado (debe devolver token temporal)
3. Verificación de código TOTP correcto
4. Verificación de código TOTP incorrecto
5. Verificación de código TOTP expirado
6. Verificación de código OTP por correo correcto
7. Verificación de código de respaldo correcto
8. Bloqueo después de 5 intentos fallidos
9. Desbloqueo después del tiempo configurado
10. Configuración de TOTP
11. Desactivación de TOTP
12. Generación de códigos de respaldo
13. Registro de dispositivo de confianza
14. Omitir 2FA con dispositivo de confianza válido
15. Flujo de recuperación de 2FA

### Frontend
1. Mostrar opciones de 2FA después de login
2. Navegación entre métodos de verificación
3. Mensajes de error claros
4. Configuración de TOTP con código QR
5. Configuración de 2FA por correo
6. Visualización de códigos de respaldo
7. Gestión de dispositivos de confianza
8. Flujo de recuperación

---

## Integración con el Sistema Existente

### Bitácora
- **No se registran** eventos de 2FA en la bitácora por proyecto
- El 2FA es una característica de la cuenta, no del proyecto
- No se modifican los permisos de bitácora existentes

### Roles
- Ningún rol tiene autoridad sobre la configuración 2FA de otros usuarios
- El Scrum Master NO puede activar/desactivar 2FA de otros
- Cada usuario gestiona su propio 2FA

### Notificaciones
- Se pueden enviar notificaciones por correo para:
  - Código OTP para verificación
  - Enlace de recuperación de 2FA
  - Confirmación de activación/desactivación

---

## Archivos a Crear/Modificar

### Nuevos Archivos

| Ruta | Descripción |
|------|-------------|
| `database/migraciones/autenticacion_2fa.sql` | Migración de base de datos |
| `database/migraciones/autenticacion_2fa_revertir.sql` | Script de reversión |
| `database/permisos_2fa.sql` | Permisos de scrumflow_app sobre tablas 2FA |
| `database/permisos_2fa_revertir.sql` | Reversión de permisos 2FA |
| `src/modulos/auth/2fa/2fa.service.js` | Servicio de lógica de 2FA |
| `src/modulos/auth/2fa/2fa.controller.js` | Controladores de 2FA |
| `src/modulos/auth/2fa/2fa.routes.js` | Rutas de 2FA |
| `src/modulos/auth/2fa/2fa.utils.js` | Utilidades (TOTP, cifrado) |
| `public/js/pages/login-2fa.js` | Lógica frontend de verificación |
| `public/css/componentes/2fa.css` | Estilos de 2FA |

### Archivos a Modificar

| Ruta | Modificaciones |
|------|---------------|
| `src/modulos/auth/auth.controller.js` | Manejar respuesta 202 con token temporal |
| `src/modulos/auth/auth.service.js` | Generar tokens temporales, verificar 2FA |
| `src/config/env.js` | Añadir variables de entorno para 2FA |
| `src/middlewares/autenticar.js` | Manejar tokens temporales |
| `src/modulos/usuarios/usuarios.routes.js` | Endpoints de configuración 2FA |
| `public/pages/login.html` | Añadir interfaz de verificación 2FA |
| `public/js/pages/login.js` | Manejar flujo de 2FA |
| `public/pages/perfil.html` | Diseño completo con barra lateral y sección de Seguridad |
| `public/js/pages/perfil.js` | Lógica completa de perfil y configuración 2FA |
| `.env.example` | Añadir variables de entorno |
| `.env` | Configurar TOTP_ENCRYPTION_KEY |

---

## Cronograma de Implementación

### Etapa 1: Base de Datos (ENTREGADA) 
- [x] Crear migración SQL
- [x] Crear script de reversión
- [x] Documentación de esquema
- [x] Script de permisos para scrumflow_app
- [x] Script de reversión de permisos

### Etapa 2: Backend (ENTREGADO)
- [x] Crear servicio de 2FA
- [x] Crear controladores de 2FA
- [x] Crear rutas de 2FA
- [x] Crear utilidades (TOTP, cifrado)
- [x] Modificar archivos existentes de auth
- [x] Añadir variables de entorno

### Etapa 3: Frontend (ENTREGADO)
- [x] Modificar login.html
- [x] Modificar login.js
- [x] Crear/Modificar perfil.html
- [x] Crear perfil.js completo
- [x] Crear estilos CSS
- [x] Crear interfaz de Seguridad

---

## Notas Finales

- El 2FA es **completamente opcional** para todos los usuarios
- La implementación **no afecta** a usuarios sin 2FA activado
- Se **reutilizan** servicios existentes (correo, JWT, autenticación)
- Se **respetan** todas las convenciones del proyecto
- No se **modifican** sistemas críticos como bitácora o permisos
