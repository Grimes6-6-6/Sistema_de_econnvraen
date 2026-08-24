import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { parseEntityId } from "@/lib/domain/ids";
import { query } from "@/server/db/pool";
import { handleRouteError, noStoreJson } from "@/server/http";
import { notFound } from "@/server/errors";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.DRIVER_SELF_MANAGE);
    const driverId = user.conductorId
      ? parseEntityId(user.conductorId, "C")
      : null;
    const agencyId = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
    if (!driverId || !agencyId) {
      throw notFound("El usuario no está vinculado a un conductor.");
    }

    const tripRes = await query<{
      id_viaje: number;
      origen: string;
      destino: string;
      fecha: string;
      hora: string;
      estado: string;
      placa: string;
      marca: string;
      modelo: string;
      id_vehiculo: number;
      id_conductor: number;
    }>(
      `SELECT
         v.id_viaje,
         r.origen,
         r.destino,
         TO_CHAR(v.fecha_hora_salida AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
         TO_CHAR(v.fecha_hora_salida AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
         v.estado,
         veh.placa,
         veh.marca,
         veh.modelo,
         v.id_vehiculo,
         v.id_conductor
       FROM viajes v
       JOIN rutas r ON r.id_ruta = v.id_ruta
       JOIN vehiculos veh ON veh.id_vehiculo = v.id_vehiculo
       WHERE v.id_conductor = $1
         AND v.id_agencia = $2
         AND v.estado IN ('PROGRAMADO', 'EN_CURSO')
         AND (v.fecha_hora_salida AT TIME ZONE 'America/Lima')::date =
             (NOW() AT TIME ZONE 'America/Lima')::date
       ORDER BY v.fecha_hora_salida ASC
       LIMIT 1`,
      [driverId, agencyId],
    );

    if (!tripRes.rows[0]) {
      return noStoreJson({ trip: null, passengers: [], parcels: [] });
    }

    const trip = tripRes.rows[0];

    const [passengers, parcels] = await Promise.all([
      query<{
        id_boleto: number;
        codigo: string;
        asiento: number;
        estado: string;
        nombres: string;
        apellidos: string;
        nro_documento: string;
        telefono: string | null;
      }>(
        `SELECT
           b.id_boleto,
           b.codigo,
           b.asiento,
           b.estado,
           p.nombres,
           p.apellidos,
           p.nro_documento,
           p.telefono
         FROM boletos b
         JOIN personas p ON p.id_persona = b.id_persona_pasajero
         WHERE b.id_viaje = $1
           AND b.estado = 'ACTIVO'
         ORDER BY b.asiento`,
        [trip.id_viaje],
      ),
      query<{
        id_encomienda: number;
        codigo_tracking: string;
        descripcion: string;
        estado: string;
        remitente: string;
        destinatario: string;
      }>(
        `SELECT
           e.id_encomienda,
           e.codigo_tracking,
           e.descripcion,
           e.estado,
           sr.nombres || ' ' || sr.apellidos AS remitente,
           sd.nombres || ' ' || sd.apellidos AS destinatario
         FROM encomiendas e
         JOIN personas sr ON sr.id_persona = e.id_persona_remitente
         JOIN personas sd ON sd.id_persona = e.id_persona_destinatario
         WHERE e.id_viaje = $1
         ORDER BY e.fecha_registro`,
        [trip.id_viaje],
      ),
    ]);

    return noStoreJson({
      trip: {
        id: `T${String(trip.id_viaje).padStart(3, "0")}`,
        code: `T${String(trip.id_viaje).padStart(3, "0")}`,
        origin: trip.origen,
        destination: trip.destino,
        date: trip.fecha,
        departureTime: trip.hora,
        vehicleId: String(trip.id_vehiculo),
        vehiclePlate: trip.placa,
        driverId: String(trip.id_conductor),
        status: trip.estado,
        passengerCount: passengers.rows.length,
        parcelCount: parcels.rows.length,
      },
      passengers: passengers.rows.map((row) => ({
        id: row.id_boleto,
        codigo: row.codigo,
        asiento: row.asiento,
        estado: row.estado,
        nombre: `${row.nombres} ${row.apellidos}`.trim(),
        documento: row.nro_documento,
        telefono: row.telefono,
      })),
      parcels: parcels.rows.map((row) => ({
        id: row.id_encomienda,
        codigo: row.codigo_tracking,
        descripcion: row.descripcion,
        estado: row.estado,
        remitente: row.remitente,
        destinatario: row.destinatario,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
