import { NextResponse } from "next/server";
import { query } from "@/server/db/pool";
import { getSessionUser } from "@/lib/auth/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = parseInt(session.id.replace('U', ''), 10);
    const { tipo, descripcion, latitud, longitud } = await request.json();
    const resolvedParams = await params;
    const tripId = resolvedParams.id;

    const driverRes = await query(
      "SELECT id_conductor FROM conductores WHERE id_usuario = $1 LIMIT 1",
      [userId]
    );

    if (driverRes.rows.length === 0) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const driverId = driverRes.rows[0].id_conductor;

    await query(
      `INSERT INTO incidencias (id_viaje, id_conductor, tipo, descripcion, latitud, longitud, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDIENTE')`,
      [tripId, driverId, tipo, descripcion, latitud, longitud]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reportando incidencia:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
