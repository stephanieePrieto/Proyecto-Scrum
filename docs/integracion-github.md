# Integración con GitHub

Cada proyecto puede mostrar commits y contribuciones de un repositorio público de GitHub. La integración requiere autenticación: si no se configura un token, ScrumFlow no hace consultas anónimas a GitHub.

## Conectar un repositorio paso a paso

### 1. Crear un token de solo lectura

1. En GitHub, abre **Settings → Developer settings → Personal access tokens → Fine-grained tokens** y elige **Generate new token**.
2. Ponle un nombre y una expiración adecuada.
3. En **Repository access**, elige **Public repositories**. Esta opción permite leer repositorios públicos aunque pertenezcan a otra cuenta; no es necesario buscar ni seleccionar la URL del repositorio aquí.
4. No agregues permisos de cuenta ni permisos de escritura. El token solo se debe usar para consultar datos públicos.
5. Genera el token y cópialo. GitHub solo lo muestra al crearlo; trátalo como una contraseña y no lo compartas.

### 2. Guardar el token en el servidor

1. En la raíz del proyecto, junto a `package.json`, abre o crea el archivo `.env`.
2. Añade el token sin borrar las demás variables:

   ```env
   GITHUB_TOKEN=pega_aqui_el_token
   ```

3. Guarda `.env` y reinicia el servidor para que lea el nuevo valor. No subas `.env` a Git ni pegues el token en el navegador o en el código del cliente. El token solo se utiliza en el servidor; nunca se devuelve a la página.

### 3. Enlazar la URL al proyecto en ScrumFlow

1. Inicia sesión y selecciona el proyecto que quieras conectar. Necesitas permiso para editar la configuración del proyecto.
2. Abre **Configuración del proyecto**.
3. En **Repositorio público de GitHub**, pega la URL HTTPS del repositorio, por ejemplo `https://github.com/propietario/repositorio`.
4. Guarda los cambios.

La URL identifica el repositorio que consultará ese proyecto. No necesitas ser su propietaria si es público. No pegues la URL en la pantalla donde se crea el token.

### 4. Comprobar la conexión

1. Abre la página **GitHub** del proyecto o pulsa **Actualizar**.
2. Comprueba que aparezca el repositorio conectado y la lista de commits con SHA, autor, fecha y mensaje. Se muestran commits recientes y se consulta un commit adicional para los contribuyentes que no aparezcan en esa lista.
3. Si acabas de cambiar el token o la URL, reinicia el servidor y vuelve a cargar la página.

Los commits y contribuciones se conservan en caché durante 5 minutos para reducir consultas. Si GitHub alcanza el límite temporal y existen resultados previos, ScrumFlow muestra esos resultados junto con un aviso. Si todavía no hay resultados guardados, muestra un mensaje indicando el límite temporal. Si no aparece el repositorio, comprueba que la URL sea correcta y que el repositorio sea público.

## Migraciones de bases existentes

Para instalaciones existentes, aplicar `database/migraciones/aplicar/github_y_tutorial_por_rol.sql` y `database/migraciones/aplicar/nombres_columnas_default.sql`, en ese orden. La primera migración también concede permisos sobre el progreso de la guía al rol estándar `scrumflow_app`; se puede volver a ejecutar para aplicar ese permiso en una base ya migrada. Si la aplicación usa un rol de base de datos personalizado, volver a ejecutar `database/permisos_aplicacion.sql` con ese rol y el rol propietario configurados. Si el tablero muestra `En revisiÃ³n`, aplicar después `database/migraciones/aplicar/reparar_codificacion_columna_revision.sql`. Esta corrección es segura para volver a ejecutar. Las instalaciones nuevas también reciben las tablas y columnas desde `database/schema.sql`.

En bases de datos existentes, aplicar también `database/migraciones/aplicar/solucion_dod_releases_reuniones.sql`. Esta migración agrega `eventos_calendario.proyecto_id`, requerido para resumir reuniones por proyecto en la participación de ScrumFlow; es segura para volver a ejecutar.
