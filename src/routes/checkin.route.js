import { Router } from 'express';
import {
  receiveReservation,
  listReservations,
  initiate,
  confirmReservation,
  pay,
  cabin,
  luggage,
  checkout,
  listCabins,
  qr,
  boardingPass
} from '../controllers/checkin.controller.js';

const router = Router();

router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'Sierra Madre Resort & Casino - Microservicio Check-in / Check-out (Equipo 11 · PR11)',
    version: '1.3.1',
    documentation: '/docs',
    health: '/health',
    endpoints: [
      { method: 'GET', path: '/api/check-in/reservations', description: 'Listar reservaciones registradas en PostgreSQL (Neon)' },
      { method: 'POST', path: '/api/check-in/reservations', description: 'Recibir reservación externa (Adaptador Tolerante ACL)' },
      { method: 'POST', path: '/api/check-in/initiate', description: 'Iniciar flujo de Check-in (ST01)' },
      { method: 'POST', path: '/api/check-in/confirm-reservation', description: 'Confirmar validación con Reservaciones (ST05)' },
      { method: 'POST', path: '/api/check-in/pay', description: 'Procesar pago con Banco / Fallback Pendiente (ST04)' },
      { method: 'GET', path: '/api/check-in/cabins', description: 'Listar cabinas registradas' },
      { method: 'POST', path: '/api/check-in/cabin', description: 'Consultar disponibilidad y asignar cabina (ST06)' },
      { method: 'POST', path: '/api/check-in/luggage', description: 'Registrar piezas y peso de equipaje (ST07)' },
      { method: 'GET', path: '/api/check-in/:id/qr', description: 'Generar QR en Base64 y notificar DATOS_PASAJERO a Embarque (SU02)' },
      { method: 'GET', path: '/api/check-in/boarding-pass/:id', description: 'Vista HTML del pase de abordar digital' },
      { method: 'POST', path: '/api/check-in/checkout', description: 'Procesar Check-out, inspección de daños y liquidación (ST08-ST12)' }
    ]
  });
});

router.get('/reservations', listReservations);
router.post('/reservations', receiveReservation);
router.post('/initiate', initiate);
router.post('/confirm-reservation', confirmReservation);
router.post('/pay', pay);
router.post('/cabin', cabin);
router.post('/luggage', luggage);
router.post('/checkout', checkout);
router.get('/cabins', listCabins);
router.get('/boarding-pass/:id', boardingPass);
router.get('/:id/qr', qr);

export default router;
