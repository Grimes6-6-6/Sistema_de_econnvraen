import { z } from "zod";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PERSON_NAME = /^[\p{L}\p{M} .'-]+$/u;
const PERU_MOBILE = /^9\d{8}$/;

const safeText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: "El texto contiene caracteres no permitidos.",
    });

const personName = safeText(2, 80).refine(
  (value) => PERSON_NAME.test(value),
  "El nombre contiene caracteres no permitidos.",
);

export const requestIdSchema = z.string().uuid();
export const dniSchema = z.string().regex(/^\d{8}$/, "El DNI debe tener 8 dígitos.");
export const phoneSchema = z
  .string()
  .regex(PERU_MOBILE, "El celular debe tener 9 dígitos y comenzar con 9.");
export const trackingCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^ECV-\d{6}-\d{5}$/, "El código de tracking no es válido.");

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9._-]+$/),
  password: z.string().min(8).max(128),
});

export const agencyIdSchema = z.object({
  agencyId: z.string().regex(/^A\d{2,10}$/),
});

export const agencyInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9-]+$/),
  name: safeText(3, 100),
  city: safeText(2, 80),
  address: safeText(5, 180),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+ -]{7,20}$/)
    .optional()
    .or(z.literal("")),
  email: z.email().trim().toLowerCase().max(150).optional().or(z.literal("")),
});

export const ticketInputSchema = z.object({
  requestId: requestIdSchema,
  id_viaje: z.string().regex(/^T\d{3,10}$/),
  asiento: z.number().int().min(1).max(80),
  pasajeroDni: dniSchema,
  pasajeroNombres: personName,
  pasajeroApellidos: personName,
  pasajeroTelefono: phoneSchema,
  precio: z.number().finite().min(0).max(100_000),
});

export const parcelInputSchema = z
  .object({
    requestId: requestIdSchema,
    id_viaje: z.string().regex(/^T\d{3,10}$/),
    remitenteDni: dniSchema,
    remitenteNombre: personName,
    remitenteTelefono: phoneSchema,
    destinatarioDni: dniSchema,
    destinatarioNombre: personName,
    destinatarioTelefono: phoneSchema,
    peso: z.number().finite().positive().max(1000),
    valor: z.number().finite().min(0).max(10_000_000),
    costo: z.number().finite().min(0).max(100_000),
    descripcion: safeText(3, 240),
  })
  .refine((value) => value.remitenteDni !== value.destinatarioDni, {
    path: ["destinatarioDni"],
    message: "El remitente y el destinatario deben ser personas diferentes.",
  });

export const tripInputSchema = z.object({
  requestId: requestIdSchema,
  id_ruta: z.string().regex(/^R\d{2,10}$/),
  id_vehiculo: z.string().regex(/^V\d{2,10}$/),
  id_conductor: z.string().regex(/^C\d{2,10}$/),
  fecha: z.iso.date(),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  precio: z.number().finite().min(0).max(100_000),
});

export const tripStatusSchema = z.object({
  newState: z.enum(["en_curso", "completado"]),
});

export const pickupInputSchema = z.object({
  requestId: requestIdSchema,
  dni: dniSchema,
  nombre: personName,
  telefono: phoneSchema,
  fecha: z.iso.date(),
  direccion: safeText(8, 180),
  descripcion: safeText(3, 240),
});

export const pickupStatusSchema = z.object({
  newState: z.enum(["completado", "cancelado"]),
});

export const pickupAssignmentSchema = z.object({
  driverId: z.string().regex(/^C\d{2,10}$/),
});

const signatureSchema = z
  .string()
  .max(500_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);

export const parcelStatusSchema = z
  .object({
    requestId: requestIdSchema,
    newState: z.enum([
      "registrado",
      "recojo_domicilio",
      "en_transito",
      "en_destino",
      "entregado",
    ]),
    location: safeText(3, 180).optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    evidence: z
      .object({
        signature: signatureSchema.nullable().optional(),
        photo: safeText(1, 200).optional(),
      })
      .nullable()
      .optional(),
  })
  .superRefine((value, context) => {
    if ((value.latitude === undefined) !== (value.longitude === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "La latitud y longitud deben enviarse juntas.",
      });
    }
    if (value.newState === "entregado" && !value.evidence?.signature) {
      context.addIssue({
        code: "custom",
        path: ["evidence", "signature"],
        message: "La entrega requiere la firma del destinatario.",
      });
    }
  });

const vehicleLocationCoordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100_000),
  speed: z.number().finite().min(0).max(300).nullable(),
  heading: z.number().finite().min(0).max(360).nullable(),
});

export const vehicleLocationUpdateSchema = z.discriminatedUnion("isActive", [
  vehicleLocationCoordinatesSchema.extend({
    conductorId: z.string().regex(/^C\d{2,10}$/).optional(),
    isActive: z.literal(true),
  }),
  z.object({
    conductorId: z.string().regex(/^C\d{2,10}$/).optional(),
    isActive: z.literal(false),
  }),
]);

export const offlineQueueSchema = z
  .array(
    z.object({
      requestId: requestIdSchema,
      parcelId: z.string().regex(/^E\d{3,10}$/),
      newState: z.enum([
        "registrado",
        "recojo_domicilio",
        "en_transito",
        "en_destino",
        "entregado",
      ]),
      timestamp: z.iso.datetime(),
      location: safeText(3, 180),
      evidence: z
        .object({
          signature: signatureSchema.nullable().optional(),
          photo: safeText(1, 200).optional(),
        })
        .nullable(),
    }),
  )
  .max(100);

export const publicTrackingSchema = z.object({
  trackingCode: trackingCodeSchema,
  recipientDniLast4: z.string().regex(/^\d{4}$/),
});

export const dniLookupSchema = z.object({
  dni: dniSchema,
});

export type TicketInput = z.infer<typeof ticketInputSchema>;
export type AgencyInput = z.infer<typeof agencyInputSchema>;
export type ParcelInput = z.infer<typeof parcelInputSchema>;
export type TripInput = z.infer<typeof tripInputSchema>;
export type TripStatusInput = z.infer<typeof tripStatusSchema>;
export type PickupInput = z.infer<typeof pickupInputSchema>;
export type PickupStatusInput = z.infer<typeof pickupStatusSchema>;
export type PickupAssignmentInput = z.infer<typeof pickupAssignmentSchema>;
export type ParcelStatusInput = z.infer<typeof parcelStatusSchema>;
export type VehicleLocationUpdateInput = z.infer<
  typeof vehicleLocationUpdateSchema
>;
