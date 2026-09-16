import { readFile } from "node:fs/promises";

const rolePermissionConfig = JSON.parse(
  await readFile(
    new URL("../src/lib/auth/role-permissions.json", import.meta.url),
    "utf8",
  ),
);
const EXPECTED_ROLES = [
  "SUPER_ADMIN",
  "ADMINISTRADOR",
  "OPERADOR",
  "CONDUCTOR",
];

const BASELINE_COLUMNS = {
  personas: ["id_persona", "nro_documento", "nombres", "apellidos"],
  vehiculos: ["id_vehiculo", "placa", "capacidad"],
  conductores: ["id_conductor", "id_persona", "nro_licencia"],
  viajes: ["id_viaje", "id_ruta", "fecha_hora_salida", "precio_final"],
  boletos: ["id_boleto", "id_viaje", "id_persona_pasajero", "asiento"],
  encomiendas: [
    "id_encomienda",
    "codigo_tracking",
    "id_persona_remitente",
    "id_persona_destinatario",
    "peso_kg",
  ],
  tracking_encomiendas: ["id_tracking", "id_encomienda", "fecha_hora"],
  solicitudes_recojo: ["id_solicitud", "id_persona", "estado"],
};

const CURRENT_COLUMNS = {
  notificaciones_lecturas: ["id_usuario", "clave", "leida_at"],
  agencias: ["id_agencia", "codigo", "estado"],
  usuarios: [
    "must_change_password",
    "temporary_password_expires_at",
    "sms_mfa_enabled",
  ],
  sesiones: [
    "mfa_verified_at",
    "mfa_challenge_expires_at",
    "sms_code_hash",
    "sms_sent_at",
    "sms_expires_at",
    "sms_attempts",
  ],
  vehiculos: ["id_agencia_base"],
  conductores: [
    "id_agencia_base",
    "identidad_estado",
    "identidad_observacion",
    "identidad_verificada_por",
    "identidad_verificada_at",
  ],
  viajes: ["id_agencia", "motivo_cancelacion"],
  boletos: [
    "id_agencia_venta",
    "motivo_anulacion",
    "nota_credito_estado",
    "metodo_pago",
    "referencia_pago",
  ],
  encomiendas: [
    "id_agencia_registro",
    "dimensiones",
    "metodo_pago",
    "referencia_pago",
  ],
  solicitudes_recojo: ["id_agencia", "id_usuario_asignado"],
  ubicaciones_vehiculos: [
    "id_conductor",
    "id_viaje",
    "request_id",
    "captured_at",
  ],
  historial_ubicaciones_vehiculos: [
    "id_ubicacion",
    "request_id",
    "id_conductor",
    "id_viaje",
    "captured_at",
    "received_at",
  ],
  solicitudes_anulacion_boletos: [
    "id_solicitud",
    "id_boleto",
    "id_agencia",
    "solicitado_por",
    "estado",
  ],
  documentos_operativos: [
    "id_documento",
    "id_agencia",
    "titular_tipo",
    "id_vehiculo",
    "id_conductor",
    "tipo_documento",
    "fecha_vencimiento",
    "estado",
    "origen_registro",
    "archivo_nombre",
    "archivo_mime",
    "archivo_tamano",
    "archivo_sha256",
    "archivo_contenido",
    "revisado_por",
    "revisado_at",
  ],
};

async function readColumns(pool) {
  const result = await pool.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'`,
  );
  const columns = new Map();
  for (const row of result.rows) {
    const values = columns.get(row.table_name) || new Set();
    values.add(row.column_name);
    columns.set(row.table_name, values);
  }
  return columns;
}

function findMissing(columns, specification) {
  const missing = [];
  for (const [table, expectedColumns] of Object.entries(specification)) {
    const actual = columns.get(table);
    for (const column of expectedColumns) {
      if (!actual?.has(column)) missing.push(`${table}.${column}`);
    }
  }
  return missing;
}

async function verifyRolePermissions(pool) {
  const result = await pool.query(
    `SELECT nombre, permisos
     FROM roles
     WHERE nombre = ANY($1::varchar[])`,
    [EXPECTED_ROLES],
  );
  const actual = new Map(result.rows.map((row) => [row.nombre, row.permisos]));
  const mismatches = [];
  for (const role of EXPECTED_ROLES) {
    const expected = rolePermissionConfig[role];
    const permissions = actual.get(role);
    if (!Array.isArray(permissions)) {
      mismatches.push(`${role} (rol ausente o permisos no son un arreglo)`);
      continue;
    }
    const expectedSorted = [...expected].sort();
    const actualSorted = [...permissions].sort();
    if (JSON.stringify(expectedSorted) !== JSON.stringify(actualSorted)) {
      mismatches.push(role);
    }
  }
  if (mismatches.length) {
    throw new Error(
      `Los permisos persistidos no coinciden con la matriz de la aplicación: ${mismatches.join(", ")}. Ejecuta las migraciones pendientes.`,
    );
  }
}

export async function verifyBaselineSchema(pool) {
  const columns = await readColumns(pool);
  const missing = findMissing(columns, BASELINE_COLUMNS);
  if (missing.length) {
    throw new Error(
      `El esquema registrado como migrado no corresponde al sistema. ` +
        `Faltan: ${missing.join(", ")}. Conserva la base y ejecuta una ` +
        `recuperación controlada; no uses scripts antiguos de inicialización.`,
    );
  }
}

export async function verifyCurrentSchema(pool) {
  const columns = await readColumns(pool);
  const missing = [
    ...findMissing(columns, BASELINE_COLUMNS),
    ...findMissing(columns, CURRENT_COLUMNS),
  ];
  if (missing.length) {
    throw new Error(
      `La base de datos no está lista para la aplicación. Faltan: ${missing.join(", ")}.`,
    );
  }
  await verifyRolePermissions(pool);
}
