import bcrypt from "bcryptjs";
import { createPool } from "./db-client.mjs";

const PASSWORD_COST = 12;
const pool = createPool();

const seedUsers = [
  {
    role: "SUPER_ADMIN",
    username:
      process.env.SEED_SUPER_ADMIN_USERNAME?.trim().toLowerCase() ||
      "superadmin",
    password: process.env.SEED_SUPER_ADMIN_PASSWORD,
    dni: "99999999",
    names: "Super",
    surnames: "Administrador",
  },
  {
    role: "ADMINISTRADOR",
    username: process.env.SEED_ADMIN_USERNAME?.trim().toLowerCase() || "admin1",
    password: process.env.SEED_ADMIN_PASSWORD,
    dni: "00000000",
    names: "Administrador",
    surnames: "General",
  },
  {
    role: "OPERADOR",
    username:
      process.env.SEED_OPERATOR_USERNAME?.trim().toLowerCase() || "operador1",
    password: process.env.SEED_OPERATOR_PASSWORD,
    dni: "38495029",
    names: "María",
    surnames: "Condori Huamán",
  },
  {
    role: "CONDUCTOR",
    username:
      process.env.SEED_DRIVER_USERNAME?.trim().toLowerCase() || "conductor1",
    password: process.env.SEED_DRIVER_PASSWORD,
    dni: "76729940",
    names: "Alexis",
    surnames: "Melgar Vila",
  },
];

const missingPasswords = seedUsers
  .filter((user) => !user.password || user.password.length < 12)
  .map((user) => user.role);

if (missingPasswords.length) {
  throw new Error(
    `Configura contraseñas de al menos 12 caracteres para: ${missingPasswords.join(", ")}.`,
  );
}

const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [731_284_902]);

  const roles = [
    [
      "SUPER_ADMIN",
      "Administración global de todas las agencias",
      ["agencias:*", "usuarios:*", "operaciones:*", "reportes:*"],
    ],
    [
      "ADMINISTRADOR",
      "Administración de sus agencias asignadas",
      ["usuarios:*", "operaciones:*", "reportes:*"],
    ],
    [
      "OPERADOR",
      "Ventas, encomiendas, viajes y recojos",
      ["boletos:write", "encomiendas:write", "viajes:write", "recojos:write"],
    ],
    [
      "CONDUCTOR",
      "Manifiestos y entregas de sus viajes",
      ["viajes:read:self", "encomiendas:update:self"],
    ],
  ];

  for (const [name, description, permissions] of roles) {
    await client.query(
      `INSERT INTO roles (nombre, descripcion, permisos)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (nombre) DO UPDATE
       SET descripcion = EXCLUDED.descripcion, permisos = EXCLUDED.permisos`,
      [name, description, JSON.stringify(permissions)],
    );
  }

  await client.query(
    `INSERT INTO agencias (codigo, nombre, ciudad, direccion)
     VALUES ('AYA', 'Agencia Ayacucho', 'Ayacucho', 'Dirección por configurar')
     ON CONFLICT (codigo) DO UPDATE
     SET nombre = EXCLUDED.nombre,
         ciudad = EXCLUDED.ciudad,
         updated_at = NOW()`,
  );

  const people = [
    ["DNI", "76729940", "Alexis", "Melgar Vila", "998877665", "CONDUCTOR"],
    ["DNI", "38495029", "María", "Condori Huamán", "955443322", "EMPLEADO"],
    ["DNI", "00000000", "Administrador", "General", null, "EMPLEADO"],
    ["DNI", "99999999", "Super", "Administrador", null, "EMPLEADO"],
  ];

  for (const [documentType, document, names, surnames, phone, type] of people) {
    await client.query(
      `INSERT INTO personas (
         tipo_documento, nro_documento, nombres, apellidos, telefono, tipo
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (nro_documento) DO UPDATE
       SET nombres = EXCLUDED.nombres,
           apellidos = EXCLUDED.apellidos,
           telefono = EXCLUDED.telefono,
           tipo = EXCLUDED.tipo,
           updated_at = NOW()`,
      [documentType, document, names, surnames, phone, type],
    );
  }

  await client.query(
    `INSERT INTO conductores (
       id_persona, id_agencia_base, nro_licencia, categoria_licencia,
       fecha_vencimiento, habilitado
     )
     SELECT person.id_persona, agency.id_agencia, 'Q76729940', 'A-IIa',
            DATE '2030-05-15', TRUE
     FROM personas person
     CROSS JOIN agencias agency
     WHERE person.nro_documento = '76729940'
       AND agency.codigo = 'AYA'
     ON CONFLICT (id_persona) DO UPDATE
     SET nro_licencia = EXCLUDED.nro_licencia,
         id_agencia_base = EXCLUDED.id_agencia_base,
         categoria_licencia = EXCLUDED.categoria_licencia,
         fecha_vencimiento = EXCLUDED.fecha_vencimiento,
         habilitado = TRUE,
         updated_at = NOW()`,
  );

  for (const user of seedUsers) {
    const passwordHash = await bcrypt.hash(user.password, PASSWORD_COST);
    await client.query(
      `INSERT INTO usuarios (username, password_hash, id_persona, id_rol, estado)
       SELECT $1, $2, p.id_persona, r.id_rol, 'ACTIVO'
       FROM personas p
       CROSS JOIN roles r
       WHERE p.nro_documento = $3 AND r.nombre = $4
       ON CONFLICT ((LOWER(username))) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           id_persona = EXCLUDED.id_persona,
           id_rol = EXCLUDED.id_rol,
           estado = 'ACTIVO',
           password_changed_at = NOW(),
           updated_at = NOW()`,
      [user.username, passwordHash, user.dni, user.role],
    );
  }

  await client.query(
    `INSERT INTO usuarios_agencias (id_usuario, id_agencia, es_principal, estado)
     SELECT user_account.id_usuario, agency.id_agencia, TRUE, 'ACTIVO'
     FROM usuarios user_account
     CROSS JOIN agencias agency
     WHERE agency.codigo = 'AYA'
       AND user_account.username = ANY($1::text[])
     ON CONFLICT (id_usuario, id_agencia) DO UPDATE
     SET es_principal = TRUE,
         estado = 'ACTIVO',
         updated_at = NOW()`,
    [seedUsers.map((user) => user.username)],
  );

  const routes = [
    ["Ayacucho", "San Francisco (VRAEM)", 120, 4, 50],
    ["Ayacucho", "Pichari (VRAEM)", 140, 5, 60],
    ["Ayacucho", "Kimbiri (VRAEM)", 135, 4.5, 55],
    ["Ayacucho", "Sivia (VRAEM)", 115, 4, 50],
    ["Ayacucho", "Huancayo", 260, 6, 70],
  ];

  for (const route of routes) {
    const destination = route[1];
    await client.query(
      `INSERT INTO agencias (codigo, nombre, ciudad, direccion)
       VALUES (
         'AG-' || UPPER(SUBSTRING(MD5(LOWER(TRIM($1))) FROM 1 FOR 8)),
         'Agencia ' || TRIM($1),
         TRIM($1),
         'Dirección por configurar'
       )
       ON CONFLICT (codigo) DO UPDATE
       SET nombre = EXCLUDED.nombre,
           ciudad = EXCLUDED.ciudad,
           updated_at = NOW()`,
      [destination],
    );

    await client.query(
      `INSERT INTO rutas (
         origen, destino, distancia_km, duracion_horas, precio_base,
         id_agencia_origen, id_agencia_destino
       )
       SELECT
         $1::varchar,
         $2::varchar,
         $3::numeric,
         $4::numeric,
         $5::numeric,
         origin.id_agencia,
         destination.id_agencia
       FROM agencias origin
       CROSS JOIN agencias destination
       WHERE origin.codigo = 'AYA'
         AND destination.codigo =
           'AG-' || UPPER(SUBSTRING(MD5(LOWER(TRIM($2::text))) FROM 1 FOR 8))
       ON CONFLICT (origen, destino) DO UPDATE
       SET distancia_km = EXCLUDED.distancia_km,
           duracion_horas = EXCLUDED.duracion_horas,
           precio_base = EXCLUDED.precio_base,
           id_agencia_origen = EXCLUDED.id_agencia_origen,
           id_agencia_destino = EXCLUDED.id_agencia_destino,
           estado = 'ACTIVO',
           updated_at = NOW()`,
      route,
    );
  }

  const vehicles = [
    ["VRA-102", "Camioneta", "Toyota", "Hilux 4x4", 4, 2022],
    ["VRA-405", "Automóvil", "Toyota", "Corolla Sedan", 4, 2021],
    ["VRA-889", "Camioneta", "Toyota", "Fortuner", 4, 2023],
  ];

  for (const vehicle of vehicles) {
    await client.query(
      `INSERT INTO vehiculos (
         placa, tipo, marca, modelo, capacidad, anio, estado, id_agencia_base
       )
       SELECT $1, $2, $3, $4, $5, $6, 'ACTIVO', agency.id_agencia
       FROM agencias agency
       WHERE agency.codigo = 'AYA'
       ON CONFLICT (placa) DO UPDATE
       SET tipo = EXCLUDED.tipo,
           marca = EXCLUDED.marca,
           modelo = EXCLUDED.modelo,
           capacidad = EXCLUDED.capacidad,
           anio = EXCLUDED.anio,
           id_agencia_base = EXCLUDED.id_agencia_base,
           estado = 'ACTIVO',
           updated_at = NOW()`,
      vehicle,
    );
  }

  await client.query("COMMIT");
  console.log(
    "Datos base creados. Las contraseñas se almacenaron únicamente como hashes bcrypt.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
