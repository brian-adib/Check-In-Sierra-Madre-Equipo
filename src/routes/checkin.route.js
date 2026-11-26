import { Router } from 'express';
import { initiate, confirmReservation, pay, cabin, luggage, checkout, listCabins, qr, boardingPass } from '../controllers/checkin.controller.js';

const router = Router();

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
