# Respaldo y recuperación

Estado: se incorporaron herramientas para exportación manual cifrada. Esto no significa que exista ya una copia de producción ni una programación automática. Configurar destino externo, responsable, retención y prueba de recuperación antes de la entrega.

## Dos capas

- Revisar en Neon → Backup & Restore la ventana de recuperación del plan contratado. Una rama en el mismo proyecto no sustituye una copia externa; no eliminar ramas ni modificar producción durante una prueba.
- Exportar periódicamente con `pg_dump` en formato custom, cifrado AES-256-GCM y manifiesto SHA-256. Incluye tablas y archivos documentarios guardados en PostgreSQL; no incluye roles globales, secretos de Vercel ni archivos que existan solo en otros servicios.

## Uso manual

Requiere Node y `pg_dump`/`pg_restore` de una versión compatible (igual o más nueva que el servidor). En Windows se buscan las instalaciones de PostgreSQL; alternativamente definir `PG_BIN_DIR`. Estos scripts **no cargan .env locales**: para evitar respaldar por accidente localhost hay que proporcionar explícitamente la conexión de origen en el entorno de ejecución seguro.

1. Crear una clave en ruta privada externa al repositorio:

   `npm run db:backup -- --init-key --key-file C:/ECONNVRAE-Privado/copia.backup-key`

2. Proporcionar `BACKUP_DATABASE_URL` mediante el gestor de secretos o entorno privado, con conexión directa a la base correcta y permisos para leer todo el esquema. No pegar la contraseña en chats, Git o historial compartido. Neon usa conexión directa (sin `-pooler`); el script adapta ese host.
3. Crear una copia:

   `npm run db:backup -- --output-dir C:/ECONNVRAE-Respaldos --key-file C:/ECONNVRAE-Privado/copia.backup-key`

4. Guardar la carpeta resultante en almacenamiento externo protegido, y la clave en otro lugar. Perder la clave hace irrecuperable el respaldo.
5. Verificar una copia con su ruta absoluta real:

   `npm run db:backup:verify -- --manifest C:/ECONNVRAE-Respaldos/CARPETA/manifest.json --key-file C:/ECONNVRAE-Privado/copia.backup-key`

La herramienta comprueba checksum, autenticidad del cifrado y lectura completa con pg_restore sin conectarse a otra base ni ejecutar SQL. Si falla, los archivos `.partial` no son respaldos válidos. No hay borrado automático ni sobrescritura de archivos existentes.

## Ensayo de restauración

Verificar un archivo no demuestra que la aplicación pueda recuperarse. En una base nueva, aislada y vacía:

1. Verificar la procedencia del respaldo: restaurar SQL de una fuente no confiable puede ejecutar código.
2. Usar `db:backup:verify` con `--decrypt-to C:/ECONNVRAE-Privado/ensayo.dump` (ruta nueva). El resultado contiene información sensible sin cifrar.
3. Restaurar con `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`, seleccionando explícitamente la conexión de la base **de ensayo**. No usar `--clean` ni apuntar a producción.
4. Reasignar permisos mínimos del usuario de aplicación, ejecutar `db:check` contra el ensayo y comprobar usuarios, viajes, boletos, encomiendas, documentos y archivos. No enviar SMS de prueba a clientes reales.
5. Registrar fecha, duración, conteos y resultado. Retirar el dump descifrado con el procedimiento de la empresa.

## Pendiente para automatizar

Definir frecuencia según pérdida de datos aceptable, almacenamiento externo, retención, alertas por fallo y responsable. La programación debe ejecutarse en infraestructura segura con secretos gestionados, no depender de que esta PC esté encendida. No se activó ningún plan de pago ni tarea remota.

Referencias: [Neon: backups](https://neon.com/docs/manage/backups), [PostgreSQL: pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).
