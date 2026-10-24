import { createPool } from "./db-client.mjs";

export async function completeActiveTrips() {
  try {
    const pool = createPool();
    console.log("Conectando para finalizar viajes en curso...");

    const colsRes = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'viajes'
    `);
    const cols = new Set(colsRes.rows.map((r) => r.column_name.toLowerCase()));
    console.log("Columnas de viajes:", Array.from(cols));

    const sets = ["estado = 'COMPLETADO'"];
    if (cols.has("hora_llegada")) {
      sets.push("hora_llegada = COALESCE(hora_llegada, CURRENT_TIME)");
    }
    if (cols.has("fecha_hora_llegada")) {
      sets.push("fecha_hora_llegada = COALESCE(fecha_hora_llegada, NOW())");
    }
    if (cols.has("updated_at")) {
      sets.push("updated_at = NOW()");
    }

    const updateSql = `
      UPDATE viajes
      SET ${sets.join(", ")}
      WHERE estado IN ('EN_CURSO', 'en_curso', 'PROGRAMADO', 'programado')
      RETURNING id_viaje;
    `;
    const res = await pool.query(updateSql);
    console.log(`Viajes finalizados (${res.rowCount}):`, res.rows.map((r) => r.id_viaje));

    const encomiendasTable = await pool.query(
      "SELECT to_regclass('public.encomiendas') AS name"
    );
    if (encomiendasTable.rows[0]?.name && res.rowCount > 0) {
      await pool.query(`
        UPDATE encomiendas
        SET estado = 'EN_DESTINO'
        WHERE estado = 'EN_TRANSITO'
          AND id_viaje IN (SELECT id_viaje FROM viajes WHERE estado = 'COMPLETADO');
      `);
      console.log("Encomiendas en tránsito actualizadas a EN_DESTINO.");
    }

    await pool.end();
  } catch (err) {
    console.warn("Aviso en completeActiveTrips:", err.message);
  }
}

if (process.argv[1]?.endsWith("complete-active-trips.mjs")) {
  await completeActiveTrips();
}
