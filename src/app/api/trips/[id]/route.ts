import { NextResponse } from "next/server";
import { query } from "@/server/db/pool";
import { getSessionUser } from "@/lib/auth/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    
    // In Next.js 15+, params is a Promise. We need to await it.
    const resolvedParams = await params;
    const tripId = resolvedParams.id;

    // Obtener Viaje
    const tripRes = await query(
      `SELECT v.*, veh.placa, veh.marca, veh.modelo 
       FROM viajes v 
       JOIN vehiculos veh ON v.id_vehiculo = veh.id_vehiculo
       WHERE v.id_viaje = $1 LIMIT 1`,
      [tripId]
    );

    if (tripRes.rows.length === 0) {
      return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 });
    }

    const trip = tripRes.rows[0];

    // Obtener Pasajeros
    const passRes = await query(
      `SELECT p.id_pasajero, p.nombre, p.documento, p.telefono, r.asiento, r.estado
       FROM reservas r
       JOIN pasajeros p ON r.id_pasajero = p.id_pasajero
       WHERE r.id_viaje = $1`,
      [trip.id_viaje]
    );

    // Obtener Encomiendas
    const encRes = await query(
      `SELECT id_encomienda, codigo, remitente, destinatario, descripcion, cantidad, estado
       FROM encomiendas
       WHERE id_viaje = $1`,
      [trip.id_viaje]
    );

    return NextResponse.json({
      trip: {
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
        passengerCount: passRes.rows.length,
        parcelCount: encRes.rows.length,
      },
      passengers: passRes.rows,
      parcels: encRes.rows
    });
  } catch (error) {
    console.error("Error API viaje detalle:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
