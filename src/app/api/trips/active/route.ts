import { NextResponse } from "next/server";
import { query } from "@/server/db/pool";
import { getSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = parseInt(session.user.id.replace('U', ''), 10);

    // Obtener el ID del conductor
    const driverRes = await query(
      "SELECT id_conductor FROM conductores WHERE id_usuario = $1 LIMIT 1",
      [userId]
    );

    if (driverRes.rows.length === 0) {
      return NextResponse.json({ error: "El usuario no es un conductor registrado" }, { status: 404 });
    }

    const driverId = driverRes.rows[0].id_conductor;

    // Buscar el viaje activo (PENDIENTE, EN_RUTA, EN_PREPARACION)
    const tripRes = await query(
      `SELECT v.*, veh.placa, veh.marca, veh.modelo 
       FROM viajes v 
       JOIN vehiculos veh ON v.id_vehiculo = veh.id_vehiculo
       WHERE v.id_conductor = $1 AND v.estado IN ('PENDIENTE', 'EN_PREPARACION', 'EN_RUTA')
       ORDER BY v.fecha ASC, v.hora_salida ASC LIMIT 1`,
      [driverId]
    );

    if (tripRes.rows.length === 0) {
      return NextResponse.json({ trip: null }); // Sin viaje activo
    }

    const trip = tripRes.rows[0];

    // Obtener Pasajeros del viaje
    const passRes = await query(
      `SELECT p.id_pasajero, p.nombre, p.documento, p.telefono, r.asiento, r.estado
       FROM reservas r
       JOIN pasajeros p ON r.id_pasajero = p.id_pasajero
       WHERE r.id_viaje = $1`,
      [trip.id_viaje]
    );

    // Obtener Encomiendas del viaje
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
    console.error("Error API viajes activos:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
