import { z } from 'zod';

// Lector Tolerante para recibir reservaciones desde el equipo de Reservaciones
export const receiveReservationSchema = z.object({
  body: z.object({
    Folio_reservacion: z.string().optional(),
    folio_reservacion: z.string().optional(),
    folio: z.string().optional(),
    num_reservacion: z.string().optional(),
    clave_reserva: z.string().optional(),
    reservationCode: z.string().optional(),
    groupCode: z.string().optional(),
    reservacion: z.record(z.any()).optional(),
  }).passthrough().refine(
    (data) =>
      Boolean(
        data.Folio_reservacion ||
        data.folio_reservacion ||
        data.folio ||
        data.num_reservacion ||
        data.clave_reserva ||
        data.reservationCode ||
        data.groupCode ||
        data.reservacion
      ),
    { message: 'Se requiere Folio_reservacion, num_reservacion, clave_reserva o objeto reservacion' }
  )
});


export const initiateCheckInSchema = z.object({
  body: z.object({
    groupCode: z.string().min(1, 'El código de reservación es requerido')
  }).passthrough()
});

export const payCheckInSchema = z.object({
  body: z.object({
    checkInId: z.coerce.number().int().positive(),
    amount: z.coerce.number().positive(),
    documentNumber: z.string().min(4).max(25).optional(),
    ctaDest: z.string().min(1).max(60).optional(),
    nomCompleto: z.string().min(1).max(100).optional(),
    cvv: z.string().min(3).max(4).optional(),
  }),
});


export const assignCabinSchema = z.object({
  body: z.object({
    checkInId: z.union([z.number(), z.string().min(1)]),
    cabinId: z.union([z.number(), z.string().min(1)])
  }).passthrough()
});

export const luggageSchema = z.object({
  body: z.object({
    checkInId: z.coerce.number().int().positive(),
    bagCount: z.coerce.number().int().min(0),
    totalWeightKg: z.coerce.number().min(0),
    isVip: z.boolean().default(false),
    pieces: z
      .array(
        z.object({
          descripcion: z.string().min(1).max(100),
          tipo: z.string().max(40).optional(),
        })
      )
      .optional(),
  }),
});

