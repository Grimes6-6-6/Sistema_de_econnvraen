import { NextResponse } from "next/server";
import { query } from "@/server/db/pool";

export async function GET() {
  try {
    // Verificar si ya existe
    const tripExist = await query("SELECT id_viaje FROM viajes WHERE codigo = 'V-AYAQ-01'");
    if (tripExist.rows.length > 0) {
      return NextResponse.json({ message: "El viaje V-AYAQ-01 ya existe en la nube." });
    }

    // Obtener primer conductor (conductor1)
    const c = await query("SELECT id_conductor FROM conductores ORDER BY id_conductor ASC LIMIT 1");
    if (c.rows.length === 0) return NextResponse.json({ error: "No hay conductores" });
    const id_conductor = c.rows[0].id_conductor;

    // Obtener vehiculo 
    const v = await query("SELECT id_vehiculo FROM vehiculos LIMIT 1");
    if (v.rows.length === 0) return NextResponse.json({ error: "No hay vehiculos" });
    const id_vehiculo = v.rows[0].id_vehiculo;

    // Crear viaje
    const today = new Date().toISOString().split('T')[0];
    const res = await query(
      `INSERT INTO viajes (id_vehiculo, id_conductor, origen, destino, fecha, hora_salida, hora_llegada, estado, codigo)
       VALUES ($1, $2, 'Ayacucho', 'Lima', $3, '14:00', '22:00', 'EN_RUTA', 'V-AYAQ-01') RETURNING id_viaje`,
      [id_vehiculo, id_conductor, today]
    );

    return NextResponse.json({ message: "Viaje de prueba insertado en la NUBE exitosamente!", id: res.rows[0].id_viaje });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
