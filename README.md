# ECONNVRAE

Plataforma Next.js para pasajes, encomiendas, viajes, recojos y seguimiento en
la ruta Ayacucho–VRAEM.

## Arquitectura

- Next.js App Router para interfaz y Route Handlers.
- PostgreSQL como única fuente de verdad para datos operativos.
- Capa de acceso a datos `server-only`; el navegador no consulta PostgreSQL.
- Sesiones opacas revocables almacenadas en PostgreSQL.
- Contraseñas almacenadas como hashes bcrypt con costo 12.
- Validación Zod en cada entrada HTTP.
- Autorización por rol en páginas, endpoints y reglas de negocio.
- Rate limiting persistente y trazabilidad de acciones.
- `localStorage` reservado únicamente para la cola temporal del modo sin conexión,
  aislada por usuario; la ubicación GPS se persiste en PostgreSQL.

## Configuración local

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.example` a `.env.local`.

3. Configura `DATABASE_URL`, `AUTH_HASH_PEPPER` y contraseñas de semilla únicas.

4. Prepara la base de datos:

   ```bash
   npm run db:check
   npm run db:migrate
   npm run db:seed
   ```

5. Elimina las variables `SEED_*_PASSWORD` del entorno después de crear los
   usuarios.

6. Inicia el proyecto:

   ```bash
   npm run dev
   ```

## Calidad

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

También puedes ejecutar todo con:

```bash
npm run verify
```

## Seguridad

- No expongas `DATABASE_URL`, `RENIEC_API_TOKEN`, `AUTH_HASH_PEPPER` ni
  variables `SEED_*` con el prefijo `NEXT_PUBLIC_`.
- Usa TLS para PostgreSQL en producción y configura `DATABASE_CA_CERT` con la
  autoridad certificadora real.
- Ejecuta las migraciones antes de iniciar una nueva versión.
- Rota claves, tokens y contraseñas periódicamente.
- El endpoint público de tracking solo devuelve estado, fecha y última
  ubicación; requiere código exacto y los últimos cuatro dígitos del DNI.
- Los archivos grandes y fotografías deben migrarse a almacenamiento de
  objetos antes de habilitar cargas reales. PostgreSQL conserva únicamente
  datos estructurados y evidencia limitada.

## Migraciones

No modifiques una migración que ya se aplicó. Agrega un nuevo archivo numerado
en `db/migrations/`. El ejecutor guarda y verifica el checksum de cada archivo.

El antiguo `schema.sql` destructivo fue retirado; ahora solo indica la ubicación
del esquema canónico.
