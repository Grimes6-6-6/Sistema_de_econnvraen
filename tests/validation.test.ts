import { describe, expect, it } from "vitest";
import {
  agencyIdSchema,
  agencyInputSchema,
  dniSchema,
  offlineQueueSchema,
  parcelInputSchema,
  parcelStatusSchema,
  publicTrackingSchema,
  ticketInputSchema,
  pickupStatusSchema,
  cancellationSchema,
  tripStatusSchema,
  vehicleLocationUpdateSchema,
} from "@/lib/validation/schemas";
import { createTrackingCode } from "@/lib/domain/tracking";

describe("validaciones de entrada", () => {
  it("valida identificadores y datos de agencias", () => {
    expect(agencyIdSchema.safeParse({ agencyId: "A002" }).success).toBe(true);
    expect(agencyIdSchema.safeParse({ agencyId: "U002" }).success).toBe(false);
    expect(
      agencyInputSchema.safeParse({
        code: "pch",
        name: "Agencia Pichari",
        city: "Pichari",
        address: "Av. Principal 123",
        phone: "966 000 000",
        email: "PICHARI@EMPRESA.PE",
      }).success,
    ).toBe(true);
    expect(
      agencyInputSchema.safeParse({
        code: "../PCH",
        name: "Agencia Pichari",
        city: "Pichari",
        address: "Av. Principal 123",
      }).success,
    ).toBe(false);
  });

  it("acepta un DNI peruano válido y rechaza formatos inválidos", () => {
    expect(dniSchema.safeParse("76729940").success).toBe(true);
    expect(dniSchema.safeParse("1234").success).toBe(false);
    expect(dniSchema.safeParse("1234567A").success).toBe(false);
  });

  it("exige tracking exacto y los últimos cuatro dígitos", () => {
    const trackingCode = createTrackingCode(
      1,
      new Date("2026-07-14T12:00:00.000Z"),
    );
    expect(
      publicTrackingSchema.safeParse({
        trackingCode,
        recipientDniLast4: "4321",
      }).success,
    ).toBe(true);
    expect(
      publicTrackingSchema.safeParse({
        trackingCode,
        recipientDniLast4: "12",
      }).success,
    ).toBe(false);
    expect(
      publicTrackingSchema.safeParse({
        trackingCode: `${trackingCode}<script>`,
        recipientDniLast4: "4321",
      }).success,
    ).toBe(false);
  });

  it("evita usar al mismo DNI como remitente y destinatario", () => {
    const result = parcelInputSchema.safeParse({
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      id_viaje: "T101",
      remitenteDni: "76729940",
      remitenteNombre: "Alexis Melgar Vila",
      remitenteTelefono: "998877665",
      destinatarioDni: "76729940",
      destinatarioNombre: "Alexis Melgar Vila",
      destinatarioTelefono: "998877665",
      peso: 2,
      valor: 100,
      costo: 20,
      descripcion: "Caja pequeña",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza sobreasignación de asientos y precios enviados por el cliente", () => {
    const base = {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      id_viaje: "T101",
      pasajeroDni: "76729940",
      pasajeroNombres: "Alexis",
      pasajeroApellidos: "Melgar Vila",
      pasajeroTelefono: "998877665",
    };
    expect(ticketInputSchema.safeParse({ ...base, asiento: 1 }).success).toBe(true);
    expect(ticketInputSchema.safeParse({ ...base, asiento: 0 }).success).toBe(false);
    expect(ticketInputSchema.safeParse({ ...base, asiento: 5 }).success).toBe(false);
    expect(ticketInputSchema.safeParse({ ...base, asiento: 1, precio: 1 }).success).toBe(false);
  });

  it("valida coordenadas y límites físicos del GPS", () => {
    const valid = {
      conductorId: "C01",
      isActive: true as const,
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      capturedAt: new Date().toISOString(),
      latitude: -13.1588,
      longitude: -74.2236,
      accuracy: 12,
      speed: 54,
      heading: 180,
    };
    expect(vehicleLocationUpdateSchema.safeParse(valid).success).toBe(true);
    expect(
      vehicleLocationUpdateSchema.safeParse({
        ...valid,
        latitude: 100,
      }).success,
    ).toBe(false);
    expect(
      vehicleLocationUpdateSchema.safeParse({
        ...valid,
        speed: 500,
      }).success,
    ).toBe(false);
    expect(
      vehicleLocationUpdateSchema.safeParse({
        ...valid,
        latitude: 40.7128,
        longitude: -74.006,
      }).success,
    ).toBe(false);
    expect(
      vehicleLocationUpdateSchema.safeParse({
        ...valid,
        accuracy: 5_001,
      }).success,
    ).toBe(false);
  });

  it("exige firma y coordenadas completas al registrar una entrega", () => {
    const base = {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      newState: "entregado" as const,
      location: "Puerta del destinatario",
    };
    expect(parcelStatusSchema.safeParse(base).success).toBe(false);
    expect(
      parcelStatusSchema.safeParse({
        ...base,
        latitude: -13.15,
        evidence: {
          signature: "data:image/png;base64,QUJDRA==",
        },
      }).success,
    ).toBe(false);
    expect(
      parcelStatusSchema.safeParse({
        ...base,
        latitude: -13.15,
        longitude: -74.22,
        evidence: {
          signature: "data:image/png;base64,QUJDRA==",
        },
      }).success,
    ).toBe(true);
  });

  it("limita la cola sin conexión a cien acciones", () => {
    const action = {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      parcelId: "E001",
      newState: "en_transito" as const,
      timestamp: "2026-07-28T12:00:00.000Z",
      location: "En ruta Ayacucho - VRAEM",
      evidence: null,
    };
    expect(offlineQueueSchema.safeParse(Array(100).fill(action)).success).toBe(
      true,
    );
    expect(offlineQueueSchema.safeParse(Array(101).fill(action)).success).toBe(
      false,
    );
  });

  it("solo permite transiciones operativas de viaje y recojo", () => {
    expect(tripStatusSchema.safeParse({ newState: "en_curso" }).success).toBe(
      true,
    );
    expect(
      tripStatusSchema.safeParse({ newState: "cancelado" }).success,
    ).toBe(false);
    expect(
      pickupStatusSchema.safeParse({ newState: "completado" }).success,
    ).toBe(true);
    expect(
      pickupStatusSchema.safeParse({ newState: "en_camino" }).success,
    ).toBe(true);
    expect(
      pickupStatusSchema.safeParse({ newState: "pendiente" }).success,
    ).toBe(false);
  });

  it("exige un motivo útil para anulaciones", () => {
    expect(cancellationSchema.safeParse({ reason: "Cliente desistió" }).success).toBe(true);
    expect(cancellationSchema.safeParse({ reason: "no" }).success).toBe(false);
  });
});
