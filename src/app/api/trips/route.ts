import { NextResponse } from "next/server";
import { query } from "@/server/db/pool";
import { getSessionUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = parseInt(session.id.replace('U', ''), 10);

    const driverRes = await query(
      "SELECT id_conductor FROM conductores WHERE id_usuario = $1 LIMIT 1",
      [userId]
    );

    if (driverRes.rows.length === 0) {
      return NextResponse.json({ trips: [] });
    }

    const driverId = driverRes.rows[0].id_conductor;

    const tripsRes = await query(
      `SELECT v.*, veh.placa 
       FROM viajes v 
       JOIN vehiculos veh ON v.id_vehiculo = veh.id_vehiculo
       WHERE v.id_conductor = $1
       ORDER BY v.fecha DESC, v.hora_salida DESC`,
      [driverId]
    );

    return NextResponse.json({
      trips: tripsRes.rows.map(trip => ({
        id: trip.id_viaje.toString(),
        code: trip.codigo,
        origin: trip.origen,
        destination: trip.destino,
        date: trip.fecha,
        departureTime: trip.hora_salida,
        estimatedArrivalTime: trip.hora_llegada,
        vehicleId: trip.id_vehiculo.toString(),
        vehiclePlate: trip.placa,
        driverId: trip.id_conductor.toString(),
        status: trip.estado,
        passengerCount: 0,
        parcelCount: 0,
      }))
    });
  } catch (error) {
    console.error("Error API trips:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
