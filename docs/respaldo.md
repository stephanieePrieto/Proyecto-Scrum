# Plan de Continuidad Operativa, Respaldos y Restauración (< 4 Horas) — ScrumFlow

## 1. Objetivos de Recuperación y Disponibilidad

- **RPO (Punto Objetivo de Recuperación):** Máximo **24 horas** (respaldo completo diario automatizado).
- **RTO (Tiempo Objetivo de Recuperación):** Máximo **4 horas** ante falla grave de la base de datos primaria.
- **SLA de Disponibilidad Mensual:** Mínimo **99.5%** en horario laboral (máximo ~3.6 horas de inactividad acumulada al mes).

## 2. Respaldos Diarios Automatizados

- **Herramienta:** `pg_dump` (PostgreSQL 18.6) en formato binario comprimido (`--format=custom`).
- **Ejecución:** Automática todos los días a las `02:00 hrs` mediante el servicio `src/services/respaldo.service.js` y ejecutable bajo demanda con `npm run backup`.
- **Ubicación y Retención:** Carpeta `backups/scrumflow_backup_<FECHA>.dump` con retención rotativa de 30 días.
- **Alertas:** Ante cualquier error de ejecución o archivo vacío, el sistema envía de inmediato una alerta por correo electrónico al Administrador (`SMTP_USUARIO`).

## 3. Procedimiento de Conmutación y Restauración (RTO < 4 Horas)

1. **Detección (0 – 5 min):** El sistema detecta la caída de PostgreSQL primario (`ECONNREFUSED` / `57P01`), conmuta lecturas a `DATABASE_REPLICA_URL` (si está configurada) o sirve automáticamente `public/pages/mantenimiento.html` (`HTTP 503`).
2. **Diagnóstico del servicio (5 – 20 min):** Verificar el servicio `postgresql-x64-18` en Servicios de Windows y revisar espacio en disco.
3. **Restauración desde respaldo (20 – 45 min):**
   - Localizar el respaldo más reciente en `backups/`.
   - Restaurar la base de datos:
     ```powershell
     pg_restore --dbname="postgresql://usuario:clave@localhost:5432/scrum" --clean --if-exists --no-owner --no-acl backups\<ARCHIVO_MAS_RECIENTE>.dump
     ```
4. **Verificación y reapertura (45 – 60 min):** Validar `GET /api/salud` y `GET /api/salud/disponibilidad`. La página `mantenimiento.html` redirige automáticamente a los usuarios al detectar que el servicio volvió.

## 4. Simulacro Trimestral de Restauración

- Cada trimestre se ejecuta `npm run backup:restore`, el cual restaura el último respaldo en una base temporal (`scrum_simulacro_rto`), mide el tiempo real en segundos y verifica que sea menor a `14,400 segundos` (4 horas).
