import { initiateCheckInSchema, payCheckInSchema, assignCabinSchema, luggageSchema } from '../validators/checkin.validator.js';
import * as checkinService from '../services/checkin.service.js';

const formatZodError = (error, res) => res.status(400).json({ success: false, error: { code: 'ERR_VALIDATION', message: error.errors[0].message } });

export const initiate = async (req, res, next) => {
  try {
    const validated = initiateCheckInSchema.parse({ body: req.body });
    const result = await checkinService.initiateCheckIn(validated.body);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error.name === 'ZodError') return formatZodError(error, res);
    next(error);
  }
};

export const confirmReservation = async (req, res, next) => {
  try {
    const { checkInId } = req.body;
    const result = await checkinService.sendToReservations(checkInId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const pay = async (req, res, next) => {
  try {
    const validated = payCheckInSchema.parse({ body: req.body });
    const result = await checkinService.processPayment(validated.body);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.name === 'ZodError') return formatZodError(error, res);
    next(error);
  }
};

export const cabin = async (req, res, next) => {
  try {
    const validated = assignCabinSchema.parse({ body: req.body });
    const result = await checkinService.assignCabin(validated.body);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.name === 'ZodError') return formatZodError(error, res);
    next(error);
  }
};

export const listCabins = async (req, res, next) => {
  try {
    const cabins = await checkinService.getCabins();
    res.status(200).json({ success: true, data: cabins });
  } catch (error) {
    next(error);
  }
};

export const qr = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await checkinService.generateQR(id);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const luggage = async (req, res, next) => {
  try {
    const validated = luggageSchema.parse({ body: req.body });
    const result = await checkinService.registerLuggage(validated.body);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.name === 'ZodError') return formatZodError(error, res);
    next(error);
  }
};

export const checkout = async (req, res, next) => {
  try {
    const { checkInId, documentNumber } = req.body;
    if (!checkInId || !documentNumber) throw new Error('Missing required fields');
    const result = await checkinService.processCheckout(checkInId, documentNumber);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const boardingPass = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = await checkinService.getBoardingPassData(id);

    if (!data) {
      return res.status(404).send("<h1>Pase no encontrado</h1>");
    }

    // Devolvemos un HTML simple y bonito para que se vea en el celular
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Pase de Abordar - Sierra Madre</title>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #0f3f3a; color: #fff; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .card { background: #fff; color: #0c1f1d; border-radius: 16px; padding: 30px; max-width: 400px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border-top: 6px solid #b08a42; }
          h1 { color: #0f3f3a; font-size: 24px; margin-top: 0; text-align: center; }
          .subtitle { text-align: center; font-size: 12px; letter-spacing: 2px; color: #586766; margin-bottom: 20px; text-transform: uppercase; }
          .detail { display: flex; justify-content: space-between; border-bottom: 1px solid #eee; padding: 12px 0; font-size: 15px; }
          .detail strong { color: #586766; font-weight: 600; text-transform: uppercase; font-size: 12px; }
          .status { background: #dcf3e6; color: #17794a; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; display: inline-block; margin: 20px auto 0; }
          .center { text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Sierra Madre</h1>
          <div class="subtitle">Pase de Abordar Digital</div>
          
          <div class="detail"><strong>Pasajero</strong> <span>${data.first_name} ${data.last_name}</span></div>
          <div class="detail"><strong>Reservación</strong> <span>${data.group_code}</span></div>
          <div class="detail"><strong>Cabina</strong> <span>${data.cabin_number || 'Pendiente'}</span></div>
          
          <div class="center">
            <div class="status">Estado: ${data.status}</div>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    next(error);
  }
};