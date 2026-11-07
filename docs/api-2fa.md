# API de Autenticación en Dos Pasos (2FA)

**Versión:** 1.0  
**Autor:** Citlaly Morales Viveros  
**Fecha:** 2024  

Este documento describe los endpoints de la API para la funcionalidad de autenticación en dos pasos (2FA) de ScrumFlow.

---

## Tabla de Contenidos

1. [Autenticación](#autenticación)
2. [Configuración de 2FA](#configuración-de-2fa)
3. [Verificación de 2FA](#verificación-de-2fa)
4. [Códigos de Respaldo](#códigos-de-respaldo)
5. [Dispositivos de Confianza](#dispositivos-de-confianza)
6. [Recuperación de 2FA](#recuperación-de-2fa)
7. [Errores](#errores)

---

## Autenticación

### Iniciar sesión (con 2FA opcional)

**Endpoint:** `POST /api/auth/login`

**Descripción:** Inicia sesión con correo y contraseña. Si el usuario tiene 2FA activado, devuelve un token temporal que requiere verificación de segundo factor.

**Request Body:**
```json
{
  "correo": "usuario@example.com",
  "password": "contraseñaSegura123"
}
```

**Responses:**

- **200 OK - 2FA no requerido:**
  ```json
  {
    "mensaje": "Inicio de sesión exitoso",
    "usuario": {
      "id": 1,
      "nombre": "Usuario",
      "correo": "usuario@example.com"
    },
    "requiere2fa": false
  }
  ```
  *Cookies:* `accessToken`, `refreshToken` (sesión completa)

- **202 Accepted - 2FA requerido:**
  ```json
  {
    "mensaje": "Se requiere verificación en dos pasos",
    "requiere2fa": true,
    "metodos": ["totp", "correo"],
    "tokenTemporal": "...",
    "tokenTemporalExpiraEn": "2024-12-01T14:30:00Z"
  }
  ```
  *Cookies:* `token2faTemporal` (token temporal, no es sesión válida)

- **401 Unauthorized:**
  ```json
  {
    "mensaje": "Credenciales incorrectas o cuenta bloqueada"
  }
  ```

- **429 Too Many Requests:**
  ```json
  {
    "mensaje": "Demasiados intentos fallidos. Inténtalo de nuevo más tarde."
  }
  ```

---

## Configuración de 2FA

### Obtener estado de 2FA

**Endpoint:** `GET /api/2fa/estado`

**Autenticación:** Requiere token de acceso válido (cookie `accessToken`)

**Descripción:** Obtiene el estado actual de configuración de 2FA para el usuario.

**Responses:**

- **200 OK:**
  ```json
  {
    "habilitado": true,
    "metodos": {
      "totp": {
        "activado": true,
        "activadoEn": "2024-11-01T10:00:00Z"
      },
      "correo": {
        "activado": true,
        "activadoEn": "2024-11-02T11:00:00Z"
      }
    },
    "codigosRespaldoGenerados": true,
    "dispositivosConfianza": 2
  }
  ```

---

### Iniciar configuración de TOTP

**Endpoint:** `POST /api/2fa/totp/iniciar`

**Autenticación:** Requiere token de acceso válido

**Descripción:** Genera un nuevo secreto TOTP y devuelve el código QR para escanear con Google Authenticator o app similar.

**Responses:**

- **200 OK:**
  ```json
  {
    "secreto": "JBSWY3DPEHPK3PXP",
    "uri": "otpauth://totp/ScrumFlow:usuario@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ScrumFlow",
    "codigoQr": "data:image/svg+xml;base64,..."
  }
  ```
  *Nota:* El secreto se devuelve en texto plano SOLO en esta respuesta. El frontend debe mostrar el QR y luego el usuario debe confirmar con un código generado.

- **400 Bad Request:**
  ```json
  {
    "mensaje": "Ya tienes TOTP configurado. Desactívalo primero para generar un nuevo secreto."
  }
  ```

---

### Confirmar configuración de TOTP

**Endpoint:** `POST /api/2fa/totp/confirmar`

**Autenticación:** Requiere token de acceso válido

**Request Body:**
```json
{
  "codigo": "123456"
}
```

**Descripción:** Verifica que el código generado por la app autenticadora coincide con el secreto temporal. Si es correcto, activa TOTP para el usuario.

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "TOTP configurado correctamente",
    "totpActivado": true
  }
  ```

- **400 Bad Request:**
  ```json
  {
    "mensaje": "Código inválido o expirado. Genera un nuevo secreto."
  }
  ```

- **401 Unauthorized:**
  ```json
  {
    "mensaje": "Debes iniciar la configuración de TOTP primero."
  }
  ```

---

### Desactivar TOTP

**Endpoint:** `POST /api/2fa/totp/desactivar`

**Autenticación:** Requiere token de acceso válido

**Descripción:** Desactiva la autenticación TOTP para el usuario. Requiere confirmación de contraseña.

**Request Body:**
```json
{
  "password": "contraseñaActual123"
}
```

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "TOTP desactivado correctamente",
    "totpActivado": false
  }
  ```

- **401 Unauthorized:**
  ```json
  {
    "mensaje": "Contraseña incorrecta"
  }
  ```

- **403 Forbidden:**
  ```json
  {
    "mensaje": "No puedes desactivar el único método de 2FA activo. Configura otro método primero."
  }
  ```

---

### Activar 2FA por correo

**Endpoint:** `POST /api/2fa/correo/activar`

**Autenticación:** Requiere token de acceso válido

**Descripción:** Activa el método de autenticación por correo electrónico. El usuario recibirá un código OTP cada vez que necesite verificar.

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Autenticación por correo activada",
    "correoActivado": true
  }
  ```

---

### Desactivar 2FA por correo

**Endpoint:** `POST /api/2fa/correo/desactivar`

**Autenticación:** Requiere token de acceso válido

**Request Body:**
```json
{
  "password": "contraseñaActual123"
}
```

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Autenticación por correo desactivada",
    "correoActivado": false
  }
  ```

- **401 Unauthorized:**
  ```json
  {
    "mensaje": "Contraseña incorrecta"
  }
  ```

- **403 Forbidden:**
  ```json
  {
    "mensaje": "No puedes desactivar el único método de 2FA activo. Configura otro método primero."
  }
  ```

---

### Activar/Desactivar 2FA global

**Endpoint:** `POST /api/2fa/habilitar`  
**Endpoint:** `POST /api/2fa/deshabilitar`

**Autenticación:** Requiere token de acceso válido

**Descripción:** Activa o desactiva completamente el 2FA para la cuenta. Cuando está deshabilitado, ningún método de 2FA se solicitará al iniciar sesión.

**Request Body (para deshabilitar):**
```json
{
  "password": "contraseñaActual123"
}
```

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "2FA habilitado/deshabilitado correctamente",
    "habilitado": true/false
  }
  ```

- **401 Unauthorized:**
  ```json
  {
    "mensaje": "Contraseña incorrecta"
  }
  ```

---

## Verificación de 2FA

### Verificar código TOTP

**Endpoint:** `POST /api/2fa/verificar/totp`

**Autenticación:** Requiere token temporal (cookie `token2faTemporal`)

**Request Body:**
```json
{
  "codigo": "123456"
}
```

**Descripción:** Verifica un código generado por la app autenticadora.

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Verificación exitosa",
    "usuario": {
      "id": 1,
      "nombre": "Usuario",
      "correo": "usuario@example.com"
    }
  }
  ```
  *Cookies:* `accessToken`, `refreshToken` (sesión completa)

- **401 Unauthorized:**
  ```json
  {
    "mensaje": "Código inválido o expirado"
  }
  ```

- **429 Too Many Requests:**
  ```json
  {
    "mensaje": "Demasiados intentos fallidos. Inténtalo de nuevo más tarde."
  }
  ```

---

### Solicitar código por correo

**Endpoint:** `POST /api/2fa/solicitar/correo`

**Autenticación:** Requiere token temporal (cookie `token2faTemporal`)

**Descripción:** Envía un código OTP al correo del usuario para verificación.

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Código enviado a tu correo electrónico"
  }
  ```

- **400 Bad Request:**
  ```json
  {
    "mensaje": "Método de correo no disponible. Configúralo primero."
  }
  ```

- **429 Too Many Requests:**
  ```json
  {
    "mensaje": "Demasiadas solicitudes. Espera antes de intentar de nuevo."
  }
  ```

---

### Verificar código de correo

**Endpoint:** `POST /api/2fa/verificar/correo`

**Autenticación:** Requiere token temporal (cookie `token2faTemporal`)

**Request Body:**
```json
{
  "codigo": "123456"
}
```

**Descripción:** Verifica el código OTP recibido por correo.

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Verificación exitosa",
    "usuario": {
      "id": 1,
      "nombre": "Usuario",
      "correo": "usuario@example.com"
    }
  }
  ```
  *Cookies:* `accessToken`, `refreshToken` (sesión completa)

- **401 Unauthorized:**
  ```json
  {
    "mensaje": "Código inválido o expirado"
  }
  ```

- **429 Too Many Requests:**
  ```json
  {
    "mensaje": "Demasiados intentos fallidos. Inténtalo de nuevo más tarde."
  }
  ```

---

### Verificar código de respaldo

**Endpoint:** `POST /api/2fa/verificar/respaldo`

**Autenticación:** Requiere token temporal (cookie `token2faTemporal`)

**Request Body:**
```json
{
  "codigo": "ABC-123-XYZ"
}
```

**Descripción:** Verifica un código de respaldo.

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Verificación exitosa",
    "usuario": {
      "id": 1,
      "nombre": "Usuario",
      "correo": "usuario@example.com"
    },
    "codigosRestantes": 9
  }
  ```
  *Cookies:* `accessToken`, `refreshToken` (sesión completa)

- **401 Unauthorized:**
  ```json
  {
    "mensaje": "Código inválido o ya utilizado"
  }
  ```

- **429 Too Many Requests:**
  ```json
  {
    "mensaje": "Demasiados intentos fallidos. Inténtalo de nuevo más tarde."
  }
  ```

---

## Códigos de Respaldo

### Generar códigos de respaldo

**Endpoint:** `POST /api/2fa/respaldo/generar`

**Autenticación:** Requiere token de acceso válido

**Descripción:** Genera 10 nuevos códigos de respaldo. Los códigos anteriores se invalidan.

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Códigos de respaldo generados",
    "codigos": [
      "ABC-123-XYZ",
      "DEF-456-UVW",
      "..."
    ]
  }
  ```
  *Importante:* Los códigos se muestran una sola vez. El frontend debe guardarlos de forma segura o permitir su descarga.

- **400 Bad Request:**
  ```json
  {
    "mensaje": "Debes tener al menos un método de 2FA activo para generar códigos de respaldo."
  }
  ```

---

### Listar información de códigos de respaldo

**Endpoint:** `GET /api/2fa/respaldo`

**Autenticación:** Requiere token de acceso válido

**Descripción:** Obtiene información sobre los códigos de respaldo (no los códigos mismos).

**Responses:**

- **200 OK:**
  ```json
  {
    "generados": true,
    "total": 10,
    "utilizados": 2,
    "restantes": 8,
    "generadosEn": "2024-11-01T10:00:00Z"
  }
  ```

---

## Dispositivos de Confianza

### Listar dispositivos de confianza

**Endpoint:** `GET /api/2fa/dispositivos`

**Autenticación:** Requiere token de acceso válido

**Descripción:** Lista todos los dispositivos de confianza del usuario.

**Responses:**

- **200 OK:**
  ```json
  {
    "dispositivos": [
      {
        "id": "uuid",
        "nombre": "Mi Laptop",
        "ipRegistro": "192.168.1.100",
        "userAgent": "Mozilla/5.0...",
        "creadoEn": "2024-11-01T10:00:00Z",
        "expiraEn": "2024-11-15T10:00:00Z",
        "revocado": false
      }
    ]
  }
  ```

---

### Confiar en este dispositivo

**Endpoint:** `POST /api/2fa/dispositivos/confiar`

**Autenticación:** Requiere token de acceso válido

**Descripción:** Registra el dispositivo actual como de confianza, permitiendo omitir el 2FA durante 14 días.

**Request Body:**
```json
{
  "nombre": "Mi PC Personal"
}
```

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Dispositivo registrado como de confianza",
    "dispositivo": {
      "id": "uuid",
      "nombre": "Mi PC Personal",
      "expiraEn": "2024-11-15T10:00:00Z"
    }
  }
  ```

---

### Revocar dispositivo de confianza

**Endpoint:** `POST /api/2fa/dispositivos/revocar`

**Autenticación:** Requiere token de acceso válido

**Request Body:**
```json
{
  "dispositivoId": "uuid"
}
```

**Descripción:** Revoca un dispositivo de confianza específico.

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Dispositivo revocado correctamente"
  }
  ```

- **404 Not Found:**
  ```json
  {
    "mensaje": "Dispositivo no encontrado"
  }
  ```

---

### Revocar todos los dispositivos

**Endpoint:** `POST /api/2fa/dispositivos/revocar-todos`

**Autenticación:** Requiere token de acceso válido

**Request Body:**
```json
{
  "password": "contraseñaActual123"
}
```

**Descripción:** Revoca todos los dispositivos de confianza del usuario.

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Todos los dispositivos revocados",
    "dispositivosRevocados": 3
  }
  ```

- **401 Unauthorized:**
  ```json
  {
    "mensaje": "Contraseña incorrecta"
  }
  ```

---

## Recuperación de 2FA

### Solicitar recuperación de 2FA

**Endpoint:** `POST /api/2fa/recuperar/solicitar`

**Descripción:** Inicia el proceso de recuperación cuando el usuario ha perdido acceso a todos sus métodos de 2FA. Envía un enlace de recuperación por correo.

**Request Body:**
```json
{
  "correo": "usuario@example.com"
}
```

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Si el correo está registrado, se enviará un enlace de recuperación"
  }
  ```

---

### Verificar token de recuperación

**Endpoint:** `POST /api/2fa/recuperar/verificar`

**Descripción:** Verifica el token de recuperación recibido por correo y desactiva temporalmente el 2FA para permitir el acceso.

**Request Body:**
```json
{
  "token": "token-de-recuperacion"
}
```

**Responses:**

- **200 OK:**
  ```json
  {
    "mensaje": "Token válido. El 2FA ha sido desactivado temporalmente. Inicia sesión nuevamente.",
    "2faTemporalDesactivado": true,
    "expiraEn": "2024-11-01T12:00:00Z"
  }
  ```

- **400 Bad Request:**
  ```json
  {
    "mensaje": "Token inválido o expirado"
  }
  ```

---

## Errores

### Códigos de error comunes

| Código | Mensaje | Descripción |
|--------|---------|-------------|
| 400 | `Código inválido o expirado` | El código OTP/TOTP/correo/respaldo no es válido o ya expiró |
| 401 | `Contraseña incorrecta` | La contraseña proporcionada no coincide |
| 401 | `No has iniciado sesión` | No hay token de acceso válido |
| 401 | `Token inválido o expirado` | El token JWT o temporal no es válido |
| 403 | `No puedes desactivar el único método` | Intento de desactivar el único método de 2FA activo |
| 403 | `Acceso denegado` | El usuario no tiene permiso para esta acción |
| 429 | `Demasiados intentos fallidos` | Se alcanzó el límite de intentos (5 para 2FA) |
| 429 | `IP bloqueada temporalmente` | La IP fue bloqueada por múltiples intentos fallidos |

### Estructura de error

Todos los errores siguen este formato:

```json
{
  "mensaje": "Descripción del error",
  "detalles": {
    "codigo": "CODIGO_ESPECIFICO",
    "intentosRestantes": 3,
    "bloqueadoHasta": "2024-11-01T12:00:00Z"
  }
}
```

---

## Consideraciones de Seguridad

1. **Tokenes temporales:** Los tokens temporales (`token2faTemporal`) tienen una vida útil limitada (15 minutos por defecto).

2. **Códigos OTP:** Los códigos OTP por correo expiran en **3 minutos**.

3. **Intentos fallidos:** Máximo **5 intentos fallidos** de verificación de 2FA antes de bloquear temporalmente (15 minutos por defecto, usando el valor de `BLOQUEO_MINUTOS`).

4. **Cifrado:** El secreto TOTP se almacena cifrado con AES-256-GCM. La clave de cifrado debe configurarse en la variable de entorno `TOTP_ENCRYPTION_KEY` (32 bytes).

5. **Hash de códigos:** Los códigos de respaldo y OTP se almacenan como hashes SHA-256, nunca en texto plano.

6. **Dispositivos de confianza:** Expiran automáticamente después de **14 días**.

7. **Códigos de respaldo:** Se generan 10 códigos alfanuméricos (formato: `XXX-XXX-XXX`).

---

## Variables de Entorno Requeridas

```
# Clave de cifrado para secretos TOTP (32 bytes, base64)
TOTP_ENCRYPTION_KEY=tuaClaveDe32BytesAqui

# Duracion del token temporal (minutos)
TOKEN_2FA_TEMPORAL_MINUTOS=15

# Duracion de los codigos OTP por correo (minutos)
OTP_CORREO_MINUTOS=3

# Maximo de intentos fallidos de 2FA
MAX_INTENTOS_2FA=5
```

---

## Flujo de Trabajo

### Flujo de inicio de sesión con 2FA activado:

```
1. POST /api/auth/login
   ↓ (202 Accepted - requiere2fa: true)
2. Cliente muestra opcions de 2FA (TOTP, Correo, Codigo de respaldo)
   ↓ (Usuario selecciona metodo)
3. POST /api/2fa/solicitar/correo (opcional, si elige correo)
   ↓ O POST /api/2fa/verificar/totp
   ↓ O POST /api/2fa/verificar/respaldo
   ↓ (200 OK con tokens de sesion)
4. Redirigir a dashboard
```

### Flujo de configuración inicial:

```
1. GET /api/2fa/estado
   ↓ (200 OK - 2FA no configurado)
2. POST /api/2fa/totp/iniciar
   ↓ (200 OK con secreto y QR)
3. Usuario escanea QR con Google Authenticator
4. POST /api/2fa/totp/confirmar (con codigo de la app)
   ↓ (200 OK - TOTP activado)
5. POST /api/2fa/habilitar
   ↓ (200 OK - 2FA habilitado globalmente)
```
