# ECONNVRAE

Plataforma web empresarial para gestionar pasajes, viajes, encomiendas, recojos a domicilio y operación de conductores en agencias de transporte de la ruta Ayacucho–VRAEM.

## Funcionalidad disponible

- Acceso seguro por roles: superadministrador, administrador, operador y conductor.
- Inicio de sesión único por usuario y contraseña, con verificación SMS opcional por cuenta, reenvío limitado y desactivación administrativa auditada.
- Matriz central de permisos aplicada tanto en la interfaz como en cada API; una URL directa no evita la autorización.
- Operación multiagencia con separación de datos y selección de agencia activa.
- Administración de usuarios por ámbito, bloqueo, cambio de rol/agencia y restablecimiento mediante contraseña temporal de un solo uso obligatorio.
- Venta de pasajes con precio controlado por el servidor y aforo máximo de cuatro asientos.
- Programación y cancelación auditada de viajes, con prevención de cruces de conductor o vehículo.
- Registro de encomiendas, código de seguimiento verificable e historial público completo.
- Solicitudes de recojo, asignación de conductor y seguimiento de estados.
- Manifiesto del conductor, incidencias de ruta, GPS ligado al viaje activo con historial, modo sin conexión y entrega con firma.
- Reporte financiero por período y ruta, impresión/PDF y exportación CSV compatible con Excel.
- Flujo de anulación con solicitud del operador y aprobación o rechazo del administrador, más auditoría global para el superadministrador.
- Gestión de rutas, precios, vehículos y vencimientos documentarios (licencia, SOAT, CITV, TUC y tarjeta de propiedad), con archivos enviados por el conductor, revisión administrativa y alertas persistentes al superadministrador.
- Validación interna de identidad exclusiva del superadministrador y bloqueo de nuevos viajes si faltan DNI/licencia aprobados o SOAT, CITV y TUC vigentes para el vehículo.
- Diseño adaptable a escritorio, tableta y teléfono, con navegación por teclado y avisos accesibles.

## Requisitos

- Node.js 20.9 o posterior.
- PostgreSQL 14 o posterior.
- HTTPS y un proxy inverso confiable para producción.

## Instalación local

1. Instalar dependencias:

   ```bash
   npm ci
   ```

2. Copiar `.env.example` como `.env.local` y completar, como mínimo:

   - `DATABASE_URL`
   - `AUTH_HASH_PEPPER` con un valor aleatorio de 32 caracteres o más
   - credenciales `TWILIO_*` para habilitar los códigos por SMS
   - las cuatro contraseñas `SEED_*_PASSWORD` únicamente durante la carga inicial

3. Preparar y validar la base de datos:

   ```bash
   npm run db:migrate
   npm run db:seed
   npm run db:check
   ```

4. Retirar las variables `SEED_*_PASSWORD` después de crear las cuentas iniciales y cambiar esas contraseñas por valores exclusivos de la empresa.

5. Iniciar el entorno:

   ```bash
   npm run dev
   ```

La aplicación queda disponible en `http://localhost:3000`.

## Verificación antes de entregar

Ejecutar siempre:

```bash
npm run verify
npm audit
```

`verify` comprueba estilo, tipos, pruebas automatizadas y compilación de producción. No se debe desplegar si algún paso falla.

## Despliegue de producción

1. Crear una base PostgreSQL exclusiva y una cuenta con los permisos mínimos necesarios.
2. Configurar `DATABASE_SSL=true` y `DATABASE_CA_CERT` cuando el proveedor exija TLS.
3. Definir `AUTH_HASH_PEPPER`; el servidor rechaza la operación de producción si falta.
4. Activar `TRUST_PROXY=true` solo si el proxy elimina y vuelve a escribir de forma confiable los encabezados reenviados.
5. Definir `ALLOWED_ORIGIN` solo cuando exista un cliente web autorizado en otro dominio.
6. Configurar `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` y `TWILIO_FROM_NUMBER` antes de activar la verificación SMS para una cuenta. `TWILIO_SMS_TRIAL_TEMPLATE=true` se usa únicamente durante la prueba gratuita y debe cambiarse a `false` al actualizar la cuenta.
7. Ejecutar `npm run db:migrate` antes de iniciar la nueva versión. Las migraciones son acumulativas y no deben editarse después de aplicarse.
   Las migraciones deben ejecutarse con la cuenta administrativa de Neon. Vercel usa una cuenta operativa limitada y valida el esquema antes de compilar. Las migraciones aplicadas forman un historial inmutable: no se borran, renombran ni editan; cualquier cambio se agrega en un archivo nuevo. Las reversiones controladas 008 a 014 están en `db/rollbacks/` y deben usarse únicamente sobre un respaldo o una rama aislada. La reversión 014 restaura la estructura antigua de TOTP, pero no puede recuperar secretos ni códigos eliminados.
8. Compilar e iniciar:

   ```bash
   npm ci
   npm run verify
   npm run start
   ```

9. Configurar copias de seguridad automáticas, monitoreo, alertas y rotación de registros en la infraestructura de la empresa.

## Integraciones que requieren provisión empresarial

- Consulta de datos por DNI mediante un proveedor externo: configurar `RENIEC_API_TOKEN`. ApiPeruDev usa registros públicos y no es una conexión directa con RENIEC. El modo simulado debe permanecer desactivado en demostración y producción.
- Emisión fiscal SUNAT/PSE: la plataforma conserva el estado interno del comprobante, pero el envío a un proveedor fiscal requiere contratar y configurar dicho servicio.
- Mapas: la visualización usa teselas de OpenStreetMap; para operación intensiva debe contratarse un proveedor con garantía de servicio o alojar teselas propias.
- SMS: la integración está preparada con Twilio. En una cuenta de prueba solo deben activarse destinatarios permitidos por el proveedor; para operar con todo el personal debe habilitarse el servicio y registrarse un celular real para cada usuario protegido.
- Correo o WhatsApp: requieren proveedor, credenciales y consentimiento de los destinatarios antes de activarse.

## Operación y seguridad

- No almacenar contraseñas, tokens, certificados ni respaldos dentro del repositorio.
- No ejecutar `db:seed` sobre una empresa ya operativa salvo que se haya revisado expresamente el efecto de actualizar las cuentas iniciales.
- Probar restauraciones de respaldo de forma periódica; una copia no verificada no constituye un plan de recuperación.
- Revisar usuarios, agencias y permisos cuando un colaborador cambia de función o deja la empresa.
- Entregar las contraseñas temporales por un canal privado: se muestran una sola vez, vencen en 24 horas y obligan a crear una contraseña nueva.
- Las anulaciones y cancelaciones exigen motivo y se registran para auditoría.
- Los documentos del conductor admiten PDF, JPG, PNG o WEBP de hasta 3 MB. Para un volumen documental mayor se debe migrar el contenido a almacenamiento privado de objetos y conservar en PostgreSQL únicamente la metadata y trazabilidad.
- El GPS web requiere mantener abierta la aplicación del conductor. Para seguimiento continuo con la pantalla bloqueada se necesita una aplicación móvil con permiso de ubicación en segundo plano o un rastreador dedicado.

## Estructura principal

- `src/app`: páginas y API web.
- `src/server`: reglas de negocio, seguridad y acceso a datos.
- `src/lib`: tipos, validaciones y utilidades compartidas.
- `db/migrations`: historial canónico del esquema PostgreSQL.
- `db/rollbacks`: reversiones controladas para migraciones sensibles.
- `scripts`: migración, carga inicial y comprobación de base de datos.
- `tests`: pruebas automatizadas de seguridad y reglas críticas.

La documentación de revisión, trazabilidad y pruebas de entrega se proporciona por separado con el proyecto.
