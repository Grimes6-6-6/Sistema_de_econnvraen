import { z } from "zod";
import { hasValidTrackingChecksum } from "@/lib/domain/tracking";

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
  .regex(/^ECV-\d{6}-\d{5}$/, "El código de tracking no es válido.")
  .refine(hasValidTrackingChecksum, "El código de tracking no supera la validación de control.");

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

const totpCodeSchema = z.string().trim().regex(/^\d{6}$/);
export const mfaVerificationSchema = z.object({
  method: z.literal("sms"),
  code: totpCodeSchema,
});

export const mfaSmsResendSchema = z.object({
  action: z.literal("resend"),
});

export const strongPasswordSchema = z
  .string()
  .min(12, "La contraseña debe tener al menos 12 caracteres.")
  .max(128)
  .regex(/[A-Z]/, "Incluye al menos una mayúscula.")
  .regex(/[a-z]/, "Incluye al menos una minúscula.")
  .regex(/[0-9]/, "Incluye al menos un número.")
  .regex(/[^A-Za-z0-9]/, "Incluye al menos un símbolo.")
  .refine((value) => !/\s/.test(value), "La contraseña no debe contener espacios.");

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(8).max(128),
    newPassword: strongPasswordSchema,
    confirmation: z.string().min(12).max(128),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    path: ["confirmation"],
    message: "La confirmación no coincide.",
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "La nueva contraseña debe ser diferente.",
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

export const agencyUpdateSchema = agencyInputSchema.partial().extend({
  state: z.enum(["ACTIVA", "INACTIVA"]).optional(),
});

const userRoleSchema = z.enum([
  "SUPER_ADMIN",
  "ADMINISTRADOR",
  "OPERADOR",
  "CONDUCTOR",
]);

const driverAccountSchema = z.object({
  licenseNumber: safeText(5, 20).transform((value) => value.toUpperCase()),
  licenseCategory: safeText(2, 10).transform((value) => value.toUpperCase()),
  licenseExpiresAt: z.iso.date(),
});

export const adminUserCreateSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(50)
      .regex(/^[a-z0-9._-]+$/),
    dni: dniSchema,
    names: personName,
    surnames: personName,
    phone: phoneSchema,
    email: z.email().trim().toLowerCase().max(150).optional().or(z.literal("")),
    role: userRoleSchema,
    smsMfaEnabled: z.boolean().default(false),
    agencyIds: z.array(z.string().regex(/^A\d{2,10}$/)).min(1).max(20),
    driver: driverAccountSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.role === "CONDUCTOR" && !value.driver) {
      context.addIssue({
        code: "custom",
        path: ["driver"],
        message: "El conductor requiere licencia, categoría y vencimiento.",
      });
    }
  });

export const adminUserUpdateSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(50)
      .regex(/^[a-z0-9._-]+$/)
      .optional(),
    names: personName.optional(),
    surnames: personName.optional(),
    phone: phoneSchema.optional().or(z.literal("")),
    email: z.email().trim().toLowerCase().max(150).optional().or(z.literal("")),
    role: userRoleSchema.optional(),
    smsMfaEnabled: z.boolean().optional(),
    state: z.enum(["ACTIVO", "INACTIVO", "BLOQUEADO"]).optional(),
    agencyIds: z.array(z.string().regex(/^A\d{2,10}$/)).min(1).max(20).optional(),
    driver: driverAccountSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No hay cambios para guardar.");

export const cancellationResolutionSchema = z.object({
  decision: z.enum(["APROBADA", "RECHAZADA"]),
  reason: safeText(5, 300),
});

export const operationalDocumentSchema = z
  .object({
    holderType: z.enum(["CONDUCTOR", "VEHICULO"]),
    holderId: z.string().regex(/^[CV]\d{2,10}$/),
    documentType: z.enum([
      "DNI",
      "LICENCIA",
      "SOAT",
      "CITV",
      "TUC",
      "TARJETA_PROPIEDAD",
      "ANTECEDENTES",
      "SALUD",
      "OTRO",
    ]),
    number: safeText(2, 60),
    issuedAt: z.iso.date().optional().or(z.literal("")),
    expiresAt: z.iso.date(),
    state: z.enum(["VIGENTE", "POR_VENCER", "VENCIDO", "OBSERVADO"]),
    notes: safeText(3, 300).optional().or(z.literal("")),
  })
  .superRefine((value, context) => {
    const expectedPrefix = value.holderType === "CONDUCTOR" ? "C" : "V";
    const vehicleDocumentTypes = new Set([
      "SOAT",
      "CITV",
      "TUC",
      "TARJETA_PROPIEDAD",
    ]);
    if (!value.holderId.startsWith(expectedPrefix)) {
      context.addIssue({
        code: "custom",
        path: ["holderId"],
        message: "El titular no corresponde al tipo seleccionado.",
      });
    }
    if (
      (value.holderType === "VEHICULO") !==
      vehicleDocumentTypes.has(value.documentType)
    ) {
      context.addIssue({
        code: "custom",
        path: ["documentType"],
        message: "El documento no corresponde al tipo de titular seleccionado.",
      });
    }
    if (value.documentType === "DNI" && !/^\d{8}$/.test(value.number)) {
      context.addIssue({
        code: "custom",
        path: ["number"],
        message: "El DNI debe contener exactamente 8 dígitos.",
      });
    }
    if (value.issuedAt && value.expiresAt < value.issuedAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "El vencimiento no puede ser anterior a la emisión.",
      });
    }
  });

export const driverOperationalDocumentSchema = z
  .object({
    documentType: z.enum([
      "DNI",
      "LICENCIA",
      "SOAT",
      "CITV",
      "TUC",
      "TARJETA_PROPIEDAD",
      "ANTECEDENTES",
      "SALUD",
      "OTRO",
    ]),
    number: safeText(2, 60),
    issuedAt: z.iso.date().optional().or(z.literal("")),
    expiresAt: z.iso.date(),
    notes: safeText(3, 300).optional().or(z.literal("")),
    vehicleId: z.string().regex(/^V\d{2,10}$/).optional().or(z.literal("")),
  })
  .superRefine((value, context) => {
    const vehicleDocumentTypes = new Set([
      "SOAT",
      "CITV",
      "TUC",
      "TARJETA_PROPIEDAD",
    ]);
    if (vehicleDocumentTypes.has(value.documentType) && !value.vehicleId) {
      context.addIssue({
        code: "custom",
        path: ["vehicleId"],
        message: "Selecciona el vehículo al que pertenece el documento.",
      });
    }
    if (value.documentType === "DNI" && !/^\d{8}$/.test(value.number)) {
      context.addIssue({
        code: "custom",
        path: ["number"],
        message: "El DNI debe contener exactamente 8 dígitos.",
      });
    }
    if (value.issuedAt && value.expiresAt < value.issuedAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "El vencimiento no puede ser anterior a la emisión.",
      });
    }
  });

export const operationalDocumentReviewSchema = z.object({
  decision: z.enum(["APROBAR", "OBSERVAR"]),
  reason: safeText(3, 300).optional().or(z.literal("")),
}).superRefine((value, context) => {
  if (value.decision === "OBSERVAR" && !value.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Indica por qué se observa el documento.",
    });
  }
});

export const driverIdentityReviewSchema = z.object({
  decision: z.enum(["VERIFICAR", "OBSERVAR"]),
  reason: safeText(3, 300).optional().or(z.literal("")),
}).superRefine((value, context) => {
  if (value.decision === "OBSERVAR" && !value.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Indica por qué no se pudo validar la identidad.",
    });
  }
});

const managedRouteBaseSchema = z.object({
  originAgencyId: z.string().regex(/^A\d{2,10}$/),
  destinationAgencyId: z.string().regex(/^A\d{2,10}$/),
  distanceKm: z.number().finite().positive().max(5_000),
  durationHours: z.number().finite().positive().max(100),
  price: z.number().finite().min(0).max(100_000),
  state: z.enum(["ACTIVO", "INACTIVO"]).default("ACTIVO"),
});

export const managedRouteSchema = managedRouteBaseSchema
  .refine((value) => value.originAgencyId !== value.destinationAgencyId, {
    path: ["destinationAgencyId"],
    message: "El destino debe ser diferente del origen.",
  });

export const managedRouteUpdateSchema = managedRouteBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "No hay cambios para guardar.")
  .refine(
    (value) =>
      !value.originAgencyId ||
      !value.destinationAgencyId ||
      value.originAgencyId !== value.destinationAgencyId,
    {
      path: ["destinationAgencyId"],
      message: "El destino debe ser diferente del origen.",
    },
  );

export const managedVehicleSchema = z.object({
  agencyId: z.string().regex(/^A\d{2,10}$/),
  plate: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{5,10}$/),
  type: safeText(2, 50),
  brand: safeText(2, 40),
  model: safeText(1, 50),
  capacity: z.number().int().min(1).max(80),
  year: z.number().int().min(1990).max(2100).optional().nullable(),
  state: z.enum(["ACTIVO", "MANTENIMIENTO", "DE_BAJA"]).default("ACTIVO"),
});

export const managedVehicleUpdateSchema = managedVehicleSchema.partial();

export const ticketInputSchema = z
  .object({
    requestId: requestIdSchema,
    id_viaje: z.string().regex(/^T\d{3,10}$/),
    asiento: z.number().int().min(1).max(4),
    pasajeroDni: dniSchema,
    pasajeroNombres: personName,
    pasajeroApellidos: personName,
    pasajeroTelefono: phoneSchema,
  })
  .strict();

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
    dimensiones: safeText(3, 60),
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

export const cancellationSchema = z.object({
  reason: safeText(5, 300),
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
  newState: z.enum(["en_camino", "completado", "cancelado"]),
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
    occurredAt: z.iso.datetime().optional(),
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
  requestId: requestIdSchema,
  capturedAt: z.iso.datetime(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(5_000),
  speed: z.number().finite().min(0).max(300).nullable(),
  heading: z.number().finite().min(0).max(360).nullable(),
});

const activeVehicleLocationUpdateSchema = vehicleLocationCoordinatesSchema
  .extend({
    conductorId: z.string().regex(/^C\d{2,10}$/).optional(),
    isActive: z.literal(true),
  })
  .superRefine((value, context) => {
  const capturedAt = Date.parse(value.capturedAt);
  const now = Date.now();
  if (capturedAt < now - 15 * 60 * 1000 || capturedAt > now + 60 * 1000) {
    context.addIssue({
      code: "custom",
      path: ["capturedAt"],
      message: "La hora de captura GPS no es válida.",
    });
  }

  const isInsidePeru =
    value.latitude >= -19 &&
    value.latitude <= 1 &&
    value.longitude >= -82 &&
    value.longitude <= -68;
  if (!isInsidePeru) {
    context.addIssue({
      code: "custom",
      path: ["latitude"],
      message: "La posición GPS está fuera del área operativa de Perú.",
    });
  }
  });

export const vehicleLocationUpdateSchema = z.discriminatedUnion("isActive", [
  activeVehicleLocationUpdateSchema,
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
      latitude: z.number().finite().min(-90).max(90).optional(),
      longitude: z.number().finite().min(-180).max(180).optional(),
      evidence: z
        .object({
          signature: signatureSchema.nullable().optional(),
          photo: safeText(1, 200).optional(),
        })
        .nullable(),
    }).superRefine((value, context) => {
      if ((value.latitude === undefined) !== (value.longitude === undefined)) {
        context.addIssue({
          code: "custom",
          path: ["latitude"],
          message: "La latitud y longitud deben enviarse juntas.",
        });
      }
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

export const tripIncidentSchema = z.object({
  tipo: z.enum([
    "MECANICA",
    "CLIMA",
    "BLOQUEO_VIA",
    "ACCIDENTE",
    "RETRASO",
    "OTRO",
  ]),
  descripcion: safeText(5, 500),
  nivel_gravedad: z.enum(["LEVE", "MODERADA", "GRAVE"]).default("LEVE"),
  latitude: z.number().finite().min(-90).max(90).optional().nullable(),
  longitude: z.number().finite().min(-180).max(180).optional().nullable(),
});

export const driverProfileUpdateSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+ -]{7,20}$/)
    .optional()
    .or(z.literal("")),
  email: z.email().trim().toLowerCase().max(150).optional().or(z.literal("")),
  address: safeText(3, 180).optional().or(z.literal("")),
});

export type TicketInput = z.infer<typeof ticketInputSchema>;
export type AgencyInput = z.infer<typeof agencyInputSchema>;
export type AgencyUpdateInput = z.infer<typeof agencyUpdateSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AdminUserCreateInput = z.infer<typeof adminUserCreateSchema>;
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;
export type CancellationResolutionInput = z.infer<typeof cancellationResolutionSchema>;
export type OperationalDocumentInput = z.infer<typeof operationalDocumentSchema>;
export type DriverOperationalDocumentInput = z.infer<typeof driverOperationalDocumentSchema>;
export type OperationalDocumentReviewInput = z.infer<typeof operationalDocumentReviewSchema>;
export type DriverIdentityReviewInput = z.infer<typeof driverIdentityReviewSchema>;
export type ManagedRouteInput = z.infer<typeof managedRouteSchema>;
export type ManagedRouteUpdateInput = z.infer<typeof managedRouteUpdateSchema>;
export type ManagedVehicleInput = z.infer<typeof managedVehicleSchema>;
export type ManagedVehicleUpdateInput = z.infer<typeof managedVehicleUpdateSchema>;
export type ParcelInput = z.infer<typeof parcelInputSchema>;
export type TripInput = z.infer<typeof tripInputSchema>;
export type TripStatusInput = z.infer<typeof tripStatusSchema>;
export type CancellationInput = z.infer<typeof cancellationSchema>;
export type PickupInput = z.infer<typeof pickupInputSchema>;
export type PickupStatusInput = z.infer<typeof pickupStatusSchema>;
export type PickupAssignmentInput = z.infer<typeof pickupAssignmentSchema>;
export type ParcelStatusInput = z.infer<typeof parcelStatusSchema>;
export type VehicleLocationUpdateInput = z.infer<
  typeof vehicleLocationUpdateSchema
>;
export type TripIncidentInput = z.infer<typeof tripIncidentSchema>;
export type DriverProfileUpdateInput = z.infer<typeof driverProfileUpdateSchema>;
