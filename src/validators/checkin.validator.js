import { z } from 'zod';

// Lector Tolerante para recibir reservaciones desde el equipo de Reservaciones
export const receiveReservationSchema = z.object({
  body: z.object({
    num_reservacion: z.string().optional(),
    clave_reserva: z.string().optional(),
    reservationCode: z.string().optional(),
    groupCode: z.string().optional(),
  }).passthrough().refine(
    (data) => Boolean(data.num_reservacion || data.clave_reserva || data.reservationCode || data.groupCode),
    { message: 'Se requiere num_reservacion, clave_reserva o groupCode' }
  )
});

export const initiateCheckInSchema = z.object({
  body: z.object({
    groupCode: z.string().min(1, 'El código de reservación es requerido')
  }).passthrough()
});

export const payCheckInSchema = z.object({
  body: z.object({
    checkInId: z.union([z.number(), z.string().min(1)]),
    amount: z.number().positive(),
    documentNumber: z.string().min(1)
  }).passthrough()
});

export const assignCabinSchema = z.object({
  body: z.object({
    checkInId: z.union([z.number(), z.string().min(1)]),
    cabinId: z.union([z.number(), z.string().min(1)])
  }).passthrough()
});

export const luggageSchema = z.object({
  body: z.object({
    checkInId: z.union([z.number(), z.string().min(1)]),
    bagCount: z.number().min(0),
    totalWeightKg: z.number().min(0),
    isVip: z.boolean().optional().default(false)
  }).passthrough()
});
