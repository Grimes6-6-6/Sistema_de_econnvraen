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
  agencias: ["id_agencia", "codigo", "estado"],
  vehiculos: ["id_agencia_base"],
  conductores: ["id_agencia_base"],
  viajes: ["id_agencia", "motivo_cancelacion"],
  boletos: [
    "id_agencia_venta",
    "motivo_anulacion",
    "nota_credito_estado",
  ],
  encomiendas: ["id_agencia_registro", "dimensiones"],
  solicitudes_recojo: ["id_agencia", "id_usuario_asignado"],
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
}
