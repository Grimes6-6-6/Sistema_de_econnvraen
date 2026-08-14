import { NextResponse } from "next/server";
import { query } from "@/server/db/pool";
import { getSessionUser } from "@/lib/auth/session";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { status } = await request.json();
    const resolvedParams = await params;
    const tripId = resolvedParams.id;

    if (!['PENDIENTE', 'EN_PREPARACION', 'EN_RUTA', 'LLEGADO', 'FINALIZADO', 'CANCELADO'].includes(status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }

    await query(
      "UPDATE viajes SET estado = $1 WHERE id_viaje = $2",
      [status, tripId]
    );

    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error("Error actualizando estado del viaje:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
