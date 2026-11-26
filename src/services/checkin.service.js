import { pool } from '../db/client.js';
import { randomUUID } from 'crypto';
import QRCode from 'qrcode';

const RESERVATIONS_URL = process.env.RESERVATIONS_URL || 'http://localhost:3001/api/reservations/confirm';
const BANK_URL = process.env.BANK_URL || 'http://localhost:3002/api/bank/charge';
const CABIN_AVAILABILITY_URL = process.env.CABIN_AVAILABILITY_URL || 'http://localhost:3003/api/cabins/availability';
const CABIN_CHECKOUT_URL = process.env.CABIN_CHECKOUT_URL || 'http://localhost:3003/api/cabins/checkout-report';

async function fetchExternalService(url, options = {}) {
  console.log(`[OUTBOUND REQUEST] -> ${options.method || 'GET'} ${url}`, options.body || '');
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawResponse: text };
  }

  console.log(`[INBOUND RESPONSE] <- Status ${response.status} desde ${url}:`, data);

  if (!response.ok) {
    const error = new Error(`Servicio externo respondió con error ${response.status}`);
    error.statusCode = response.status;
    error.externalData = data;
    throw error;
  }

  return data;
}

export const initiateCheckIn = async (data) => {
  const { groupCode } = data;
  const groupResult = await pool.query('SELECT id FROM check_in_groups WHERE group_code = $1', [groupCode]);
  if (groupResult.rows.length === 0) {
    const error = new Error('Reservation not found');
    error.code = 'ERR_RESERVATION_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  const groupId = groupResult.rows[0].id;
  const passengersResult = await pool.query('SELECT * FROM passengers WHERE group_id = $1', [groupId]);
  const passengers = passengersResult.rows;

  let hasAdult = false;
  let hasMinor = false;
  for (const pax of passengers) {
    const age = new Date().getFullYear() - new Date(pax.birth_date).getFullYear();
    if (age >= 18) hasAdult = true;
    if (age < 18) hasMinor = true;
  }
  if (hasMinor && !hasAdult) {
    const error = new Error('Minors require at least one adult.');
    error.code = 'ERR_AGE_REQUIREMENT';
    error.statusCode = 422;
    throw error;
  }

  const checkInIds = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const pax of passengers) {
      const existing = await client.query('SELECT id FROM check_ins WHERE passenger_id = $1', [pax.id]);
      let checkInId;
      if (existing.rows.length > 0) {
        checkInId = existing.rows[0].id;
      } else {
        checkInId = randomUUID();
        await client.query(
          `INSERT INTO check_ins (id, passenger_id, status) VALUES ($1, $2, 'PENDING')`,
          [checkInId, pax.id]
        );
      }
      checkInIds.push(checkInId);
    }
    await client.query('COMMIT');
    return { groupId, checkInIds };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// CONEXIÓN REAL A RESERVACIONES
export const sendToReservations = async (checkInId) => {
  const data = await fetchExternalService(RESERVATIONS_URL, {
    method: 'POST',
    body: JSON.stringify({ checkInId, status: 'PENDING_CONFIRMATION' })
  });

  if (data.success === false || data.validado === false) {
    const error = new Error('Reservaciones rechazó el Check-in');
    error.code = 'ERR_RESERVATION_REJECTED';
    error.statusCode = 400;
    throw error;
  }
  return data;
};

// CONEXIÓN REAL A BANCO
export const processPayment = async (data) => {
  const { checkInId, amount, documentNumber } = data;
  const result = await fetchExternalService(BANK_URL, {
    method: 'POST',
    body: JSON.stringify({ amount, document: documentNumber })
  });

  if (result.success === false) {
    const error = new Error('Payment declined');
    error.code = 'ERR_PAYMENT_PENDING';
    error.statusCode = 402;
    throw error;
  }
  await pool.query(
    `INSERT INTO payments (id, check_in_id, external_transaction_id, amount_cents, status) VALUES ($1, $2, $3, $4, 'PAID')`,
    [randomUUID(), checkInId, result.transactionId || result.noTr || null, Math.round(amount * 100)]
  );
  return { message: 'Payment processed successfully', externalResponse: result };
};

// CONEXIÓN REAL A CABINAS (Disponibilidad y registro local de cabina real)
export const assignCabin = async (data) => {
  const { checkInId, cabinId } = data;
  const result = await fetchExternalService(`${CABIN_AVAILABILITY_URL}/${cabinId}`);

  if (result.success === false || result.available === false) {
    const error = new Error('Cabin is full or not found');
    error.code = 'ERR_CABIN_FULL';
    error.statusCode = 409;
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Si la cabina real aún no existe en nuestra BD local, la insertamos con los datos que envió el microservicio de Cabinas
    await client.query(
      `INSERT INTO cabins (id, cabin_number, deck, capacity, occupied)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (id) DO UPDATE SET occupied = cabins.occupied + 1`,
      [cabinId, result.cabinNumber || cabinId, result.deck || 'N/A', result.capacity || 2]
    );
    await client.query(
      `UPDATE check_ins SET cabin_id = $1, status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [cabinId, checkInId]
    );
    await client.query('COMMIT');
    return { message: 'Cabin assigned successfully' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const getCabins = async () => {
  const result = await pool.query('SELECT id, cabin_number, deck, capacity, occupied FROM cabins');
  return result.rows;
};

export const generateQR = async (checkInId) => {
  const checkInResult = await pool.query('SELECT status, qr_payload FROM check_ins WHERE id = $1', [checkInId]);
  if (checkInResult.rows.length === 0) {
    const e = new Error('Check-in not found');
    e.code = 'ERR_NOT_FOUND';
    e.statusCode = 404;
    throw e;
  }
  const checkIn = checkInResult.rows[0];
  if (checkIn.status !== 'IN_PROGRESS' && checkIn.status !== 'COMPLETED') {
    const e = new Error('Check-in is not ready');
    e.code = 'ERR_CHECKIN_INCOMPLETE';
    e.statusCode = 400;
    throw e;
  }

  if (checkIn.qr_payload) return { qrBase64: checkIn.qr_payload };

  const baseUrl = process.env.PUBLIC_URL || 'https://onrender.com';
  const payload = `${baseUrl}/api/check-in/boarding-pass/${checkInId}`;

  const qrBase64 = await QRCode.toDataURL(payload);
  await pool.query('UPDATE check_ins SET qr_payload = $1 WHERE id = $2', [qrBase64, checkInId]);
  return { qrBase64 };
};

export const registerLuggage = async (data) => {
  const { checkInId, bagCount, totalWeightKg, isVip } = data;
  let extraFee = 0;
  if (!isVip) {
    const extraBags = Math.max(0, bagCount - 1);
    const extraWeight = Math.max(0, totalWeightKg - 20);
    extraFee = (extraBags * 10) + (extraWeight * 10);
  }
  if (extraFee > 0) {
    const e = new Error('Luggage limit exceeded');
    e.code = 'ERR_LUGGAGE_LIMIT';
    e.statusCode = 422;
    throw e;
  }
  await pool.query(
    `INSERT INTO luggage (id, check_in_id, bag_count, total_weight_kg, extra_fee_cents) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), checkInId, bagCount, totalWeightKg, Math.round(extraFee * 100)]
  );
  return { message: 'Luggage registered successfully', extraFee };
};

// CONEXIÓN REAL A CABINAS Y BANCO EN CHECK-OUT
export const processCheckout = async (checkInId, documentNumber) => {
  const result = await pool.query('SELECT cabin_id FROM check_ins WHERE id = $1', [checkInId]);
  if (result.rows.length === 0 || !result.rows[0].cabin_id) {
    const e = new Error('Cabin not assigned');
    e.code = 'ERR_NO_CABIN';
    e.statusCode = 400;
    throw e;
  }
  const cabinId = result.rows[0].cabin_id;

  const cabinReport = await fetchExternalService(`${CABIN_CHECKOUT_URL}/${cabinId}`);

  let chargeMessage = 'Check-out successful. No extra charges.';
  if (cabinReport.hasCharges && cabinReport.amount > 0) {
    const bankResult = await fetchExternalService(BANK_URL, {
      method: 'POST',
      body: JSON.stringify({ amount: cabinReport.amount, document: documentNumber })
    });
    if (bankResult.success === false) {
      const e = new Error('Extra charges declined');
      e.code = 'ERR_PAYMENT_PENDING';
      e.statusCode = 402;
      throw e;
    }
    await pool.query(
      `INSERT INTO payments (id, check_in_id, external_transaction_id, amount_cents, concept, status) VALUES ($1, $2, $3, $4, 'CHECK_OUT_EXTRA', 'PAID')`,
      [randomUUID(), checkInId, bankResult.transactionId || bankResult.noTr || null, Math.round(cabinReport.amount * 100)]
    );
    chargeMessage = `Check-out successful. Extra charge of $${cabinReport.amount} processed for: ${cabinReport.reason}`;
  }
  await pool.query("UPDATE check_ins SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [checkInId]);
  return { message: chargeMessage };
};

export const getBoardingPassData = async (checkInId) => {
  const res = await pool.query(
    `SELECT c.id, c.status, p.first_name, p.last_name, cab.cabin_number, g.group_code 
     FROM check_ins c
     JOIN passengers p ON c.passenger_id = p.id
     JOIN check_in_groups g ON p.group_id = g.id
     LEFT JOIN cabins cab ON c.cabin_id = cab.id
     WHERE c.id = $1`,
    [checkInId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
};
