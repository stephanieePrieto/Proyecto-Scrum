# Ejecución de la base de datos (ScrumFlow / AgileDesk)

Guía para crear la base desde cero en Windows, con PowerShell o con la consola `psql` de pgAdmin 4.

---

## 1. Antes de empezar

- PostgreSQL 13 o superior instalado. El instalador de Windows ya incluye `pgcrypto`, que usa `seed.sql`.
- La contraseña del usuario `postgres` (superusuario).
- Los archivos en una carpeta `database` con esta estructura:

```
database/
├── schema.sql
├── seed.sql
├── seed_bitacora.sql
├── seed_metricas.sql
├── seed_curso_scrum.sql
├── permisos_aplicacion.sql
├── bitacora_permisos.sql
├── permisos_2fa.sql
├── permisos_2fa_revertir.sql
└── migraciones/
    ├── aplicar/
    │   ├── sesiones.sql
    │   ├── autenticacion_2fa.sql
    │   └── ...  (el resto de las migraciones)
    └── revertir/
        ├── sesiones_revertir.sql
        └── ...  (el resto de las reversiones)
```

Los archivos en migraciones están divididos entre los ejecutables y sus reversiones (`migraciones/aplicar` y `migraciones/revertir`).

---

## 2. Variables (PowerShell)

Pegar este bloque al inicio de una sesión de PowerShell y ajustar los valores marcados.

```powershell
# Ajustar estos valores antes de ejecutar
$PSQL     = "C:\Program Files\PostgreSQL\18\bin\psql.exe"   # cambiar 18 por su versión
$SERVIDOR = "localhost"
$PUERTO   = "5432"
$BD       = "scrum"                                     # nombre de la base
$SUPER    = "postgres"                                      # superusuario
$ADMIN    = "scrumflow_admin"                               # dueño de la estructura
$APP      = "scrumflow_app"                                 # usuario de la aplicación
$CARPETA  = "C:\Users\TU_USUARIO\Documentos\scrumflow\database" # cambiar la dirección a donde se encuentre database

# Codificación UTF-8 para que los acentos se vean bien
$env:PGCLIENTENCODING = "UTF8"

# Función para ejecutar un archivo y detenerse si hay error
function Ejecutar {
    param(
        [string]$Usuario,
        [string]$Ruta,
        [string[]]$Extra = @()
    )
    & $PSQL -h $SERVIDOR -p $PUERTO -U $Usuario -d $BD -v ON_ERROR_STOP=1 @Extra -f "$CARPETA\$Ruta"
    if ($LASTEXITCODE -ne 0) {
        throw "Error al ejecutar $Ruta. Corrige el problema antes de seguir."
    }
}
```

Para no escribir la contraseña en cada comando, puedes usar `$env:PGPASSWORD = "tu_contraseña"` antes de los comandos. Si prefieres no guardarla en texto, déjala vacía: `psql` te la pedirá cada vez.

---

## 3. Dónde debes estar ubicado

- **PowerShell:** los comandos usan la ruta completa (`$CARPETA\...`), así que no importa desde qué carpeta los ejecutes. Si escribes rutas relativas como `-f schema.sql`, primero entra a la carpeta con `cd $CARPETA`.
- **psql (pgAdmin 4):** los comandos `\i` y `\cd` se resuelven desde la carpeta donde se abrió psql, no desde donde tú estás. Por eso empieza con `\cd` a la carpeta `database` antes de cualquier `\i`.
- **Consola de pgAdmin, no el Query Tool:** las instrucciones `\i`, `\set`, `\cd` y `\password` solo funcionan en la consola de psql. El Query Tool de pgAdmin no las entiende.
- **Quién ejecuta cada paso:** los scripts de permisos (`permisos_aplicacion.sql`, `bitacora_permisos.sql`, `permisos_2fa.sql`) necesitan un superusuario. El resto puede correrse como `postgres` sin problema.

---

## 4. Orden de ejecución

Ejecuta los pasos en orden. Cada uno depende de los anteriores.

| Paso | Archivo                                                       | Usuario    | Requisito                                      |
| ---- | ------------------------------------------------------------- | ---------- | ---------------------------------------------- |
| 0    | Crear la base                                                 | `postgres` | Ninguno                                        |
| 1    | `schema.sql`                                                  | `postgres` | Base vacía                                     |
| 2    | `migraciones/aplicar/sesiones.sql`                            | `postgres` | `schema.sql`                                   |
| 3    | `migraciones/aplicar/autenticacion_2fa.sql`                   | `postgres` | `sesiones.sql`                                 |
| 4    | `migraciones/aplicar/autenticacion_2fa_intentos.sql`          | `postgres` | `autenticacion_2fa.sql`                        |
| 5    | `migraciones/aplicar/autenticacion_2fa_recuperacion.sql`      | `postgres` | `schema.sql`                                   |
| 6    | `migraciones/aplicar/preferencias_app.sql`                    | `postgres` | `schema.sql`                                   |
| 7    | `migraciones/aplicar/zona_horaria_opcional.sql`               | `postgres` | `schema.sql`                                   |
| 8    | `migraciones/aplicar/notificaciones_preferencias_canales.sql` | `postgres` | `schema.sql`. **Debe ir antes que el paso 9.** |
| 9    | `migraciones/aplicar/notificaciones_preferencias_tipo.sql`    | `postgres` | Paso 8                                         |
| 10   | `migraciones/aplicar/columnas_tablero_predeterminadas.sql`    | `postgres` | `schema.sql`                                   |
| 11   | `migraciones/aplicar/planning_poker.sql`                      | `postgres` | `schema.sql`                                   |
| 12   | `migraciones/aplicar/planning_poker_historial.sql`            | `postgres` | Paso 11                                        |
| 13   | `migraciones/aplicar/curso_scrum.sql`                         | `postgres` | `schema.sql`                                   |
| 14   | `migraciones/aplicar/bitacora_inmutable.sql`                  | `postgres` | `schema.sql`                                   |
| 15   | `seed.sql`                                                    | `postgres` | `schema.sql` y migraciones                     |
| 16   | `seed_bitacora.sql`                                           | `postgres` | Paso 15                                        |
| 17   | `seed_metricas.sql`                                           | `postgres` | Paso 15                                        |
| 18   | `seed_curso_scrum.sql`                                        | `postgres` | Paso 13                                        |
| 19   | `permisos_aplicacion.sql`                                     | `postgres` | Todas las tablas ya creadas                    |
| 20   | `bitacora_permisos.sql`                                       | `postgres` | Paso 19. Lleva variables (ver abajo).          |
| 21   | `permisos_2fa.sql`                                            | `postgres` | Paso 19                                        |
| 22   | Contraseña de `scrumflow_app`                                 | `postgres` | Paso 19                                        |

**Notas del orden:**

- Los permisos van al final porque `permisos_aplicacion.sql` transfiere las tablas al rol propietario. Si lo corres antes de crear las tablas, no tendrá efecto sobre ellas.
- Cada vez que agregues una migración nueva, vuelve a correr `permisos_aplicacion.sql` y después `bitacora_permisos.sql`.
- `bitacora_permisos.sql` necesita dos variables: `rol_app` y `rol_propietario`.

### Paso 0: crear la base (PowerShell)

```powershell
& $PSQL -h $SERVIDOR -p $PUERTO -U $SUPER -d postgres -c "CREATE DATABASE $BD ENCODING 'UTF8' TEMPLATE template0;"
```

---

## 5. Ejecución completa en PowerShell

Con las variables y la función cargadas (sección 2), ejecuta:

```powershell
# Estructura
Ejecutar -Usuario $SUPER -Ruta "schema.sql"

# Migraciones
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\sesiones.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\autenticacion_2fa.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\autenticacion_2fa_intentos.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\autenticacion_2fa_recuperacion.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\preferencias_app.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\zona_horaria_opcional.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\notificaciones_preferencias_canales.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\notificaciones_preferencias_tipo.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\columnas_tablero_predeterminadas.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\planning_poker.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\planning_poker_historial.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\curso_scrum.sql"
Ejecutar -Usuario $SUPER -Ruta "migraciones\aplicar\bitacora_inmutable.sql"

# Datos de prueba
Ejecutar -Usuario $SUPER -Ruta "seed.sql"
Ejecutar -Usuario $SUPER -Ruta "seed_bitacora.sql"
Ejecutar -Usuario $SUPER -Ruta "seed_metricas.sql"
Ejecutar -Usuario $SUPER -Ruta "seed_curso_scrum.sql"

# Permisos
Ejecutar -Usuario $SUPER -Ruta "permisos_aplicacion.sql" -Extra @("-v", "rol_app=$APP", "-v", "rol_propietario=$ADMIN")
Ejecutar -Usuario $SUPER -Ruta "bitacora_permisos.sql"   -Extra @("-v", "rol_app=$APP", "-v", "rol_propietario=$ADMIN")
Ejecutar -Usuario $SUPER -Ruta "permisos_2fa.sql"
```

Al terminar, asigna la contraseña del usuario de la aplicación. Es mejor hacerlo desde la consola de psql con `\password`, porque así no queda escrita en el historial de PowerShell:

```powershell
& $PSQL -h $SERVIDOR -p $PUERTO -U $SUPER -d $BD
```

Dentro de psql:

```
\password scrumflow_app
\q
```

---

## 6. Ejecución en la consola psql de pgAdmin 4

1. En pgAdmin, abre **Tools > PSQL Tool** (en algunas versiones aparece como **PSQL Tool** en el menú Tools; si no lo encuentras, usa PowerShell de la sección 5).
2. Pega los comandos en orden. Primero configura el entorno:

```
\encoding UTF8
\set ON_ERROR_STOP on
\cd "C:/Users/TU_USUARIO/Documentos/scrumflow/database"
\c scrumflow
```

3. Luego ejecuta los archivos. `\i` usa la ruta relativa a `\cd`:

```
\i schema.sql
\i migraciones/aplicar/sesiones.sql
\i migraciones/aplicar/autenticacion_2fa.sql
\i migraciones/aplicar/autenticacion_2fa_intentos.sql
\i migraciones/aplicar/autenticacion_2fa_recuperacion.sql
\i migraciones/aplicar/preferencias_app.sql
\i migraciones/aplicar/zona_horaria_opcional.sql
\i migraciones/aplicar/notificaciones_preferencias_canales.sql
\i migraciones/aplicar/notificaciones_preferencias_tipo.sql
\i migraciones/aplicar/columnas_tablero_predeterminadas.sql
\i migraciones/aplicar/planning_poker.sql
\i migraciones/aplicar/planning_poker_historial.sql
\i migraciones/aplicar/curso_scrum.sql
\i migraciones/aplicar/bitacora_inmutable.sql
\i seed.sql
\i seed_bitacora.sql
\i seed_metricas.sql
\i seed_curso_scrum.sql
```

4. Permisos. `bitacora_permisos.sql` lee las variables con `\set`, así que defínelas antes:

```
\set rol_app scrumflow_app
\set rol_propietario scrumflow_admin
\i permisos_aplicacion.sql
\i bitacora_permisos.sql
\i permisos_2fa.sql
\password scrumflow_app
```

Si una instrucción falla, psql se detiene (`ON_ERROR_STOP`). Corrige el error y vuelve a empezar desde ese archivo. No todos los scripts son seguros de volver a correr: algunos cambian datos cada vez. Revisa el encabezado de cada archivo antes de repetirlo.

---

## 7. Verificación

Dentro de psql, conectado a `scrumflow`:

```
\dt
SELECT COUNT(*) FROM curso_lecciones;
SELECT COUNT(*) FROM curso_quizzes;
```

Después de todo el proceso, `curso_lecciones` debe tener 5 filas (lecciones 1 a 4 y la 999) y `curso_quizzes` debe tener 16 (4 preguntas por lección). Si tus números son distintos, revisa que `seed_curso_scrum.sql` se haya ejecutado completo.

---

## 8. Revertir la base

Las reversiones se ejecutan en este orden. Revertir borra datos de las tablas que se eliminan.

| Paso | Archivo                                                                 | Qué borra                                     |
| ---- | ----------------------------------------------------------------------- | --------------------------------------------- |
| 1    | `migraciones/revertir/bitacora_inmutable_revertir.sql`                  | Solo el bloqueo de TRUNCATE                   |
| 2    | `permisos_2fa_revertir.sql`                                             | Permisos de `scrumflow_app` sobre tablas 2FA  |
| 3    | `migraciones/revertir/curso_scrum_revertir.sql`                         | Tablas del curso y su progreso                |
| 4    | `migraciones/revertir/planning_poker_historial_revertir.sql`            | Índice parcial; restaura UNIQUE si es posible |
| 5    | `migraciones/revertir/planning_poker_revertir.sql`                      | Tablas de Planning Poker y sus votos          |
| 6    | `migraciones/revertir/columnas_tablero_predeterminadas_revertir.sql`    | Columnas predeterminadas sin tareas           |
| 7    | `migraciones/revertir/notificaciones_preferencias_tipo_revertir.sql`    | Claves de desviación e impedimento            |
| 8    | `migraciones/revertir/notificaciones_preferencias_canales_revertir.sql` | Vuelve a las claves globales                  |
| 9    | `migraciones/revertir/zona_horaria_opcional_revertir.sql`               | Vuelve a poner zona horaria obligatoria       |
| 10   | `migraciones/revertir/preferencias_app_revertir.sql`                    | No borra la columna ni sus datos              |
| 11   | `migraciones/revertir/autenticacion_2fa_recuperacion_revertir.sql`      | Tabla de recuperación                         |
| 12   | `migraciones/revertir/autenticacion_2fa_intentos_revertir.sql`          | Tabla de intentos por usuario                 |
| 13   | `migraciones/revertir/autenticacion_2fa_revertir.sql`                   | Tablas 2FA                                    |
| 14   | `migraciones/revertir/sesiones_revertir.sql`                            | Tabla de sesiones                             |

Los permisos de `permisos_aplicacion.sql` y `bitacora_permisos.sql` no tienen reversión. Los datos de prueba (`seed*.sql`) no tienen reversión; se van junto con las tablas que llenan.

Para ejecutarlas en PowerShell, usa la misma función `Ejecutar`, con las rutas de la tabla.

---

## 9. Pendientes y advertencias

- **Migración de canales en una base nueva:** `schema.sql` ya trae el formato por canal, así que `notificaciones_preferencias_canales.sql` no cambia nada en una base creada desde `schema.sql`. Solo aplica a bases antiguas con claves globales.
- **Contraseñas:** no dejes contraseñas en archivos que compartas. Usa `\password` o la variable `PGPASSWORD` solo durante la sesión.
- **Probar antes de producción:** no pude ejecutar estos scripts en un PostgreSQL real durante la revisión. Pruébalos en una base de copia.
