import { pool } from '../db/client.js';
import QRCode from 'qrcode';

const RESERVATIONS_URL = process.env.RESERVATIONS_URL || 'http://localhost:3001/api/reservations/confirm';
const BANK_URL = process.env.BANK_URL || 'http://localhost:3002/api/bank/charge';
const CABIN_AVAILABILITY_URL = process.env.CABIN_AVAILABILITY_URL || 'http://localhost:3003/api/cabins/availability';
const CABIN_CHECKOUT_URL = process.env.CABIN_CHECKOUT_URL || 'http://localhost:3003/api/cabins/checkout-report';
const BOARDING_URL = process.env.BOARDING_URL || '';

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
    error.isBusinessRejection = response.status >= 400 && response.status < 500;
    throw error;
  }

  return data;
}

// 1. ADAPTADOR TOLERANTE: Recibe reservación (1 pasajero o toda una familia) desde Reservaciones
export const receiveExternalReservation = async (rawBody) => {
  const baseCode = String(
    rawBody.num_reservacion || rawBody.clave_reserva || rawBody.reservationCode || rawBody.groupCode
  ).trim().toUpperCase();

  const numCabina = String(
    rawBody.num_cabina || rawBody.cabina || rawBody.cabinNumber || 'PENDIENTE'
  ).trim().slice(0, 10);

  const fechaEmbarque = rawBody.fecha_embarque || rawBody.embarkDate || new Date().toISOString().slice(0, 10);
  const fechaDesembarque = rawBody.fecha_desembarque || rawBody.disembarkDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const rawList = Array.isArray(rawBody.pasajeros)
    ? rawBody.pasajeros
    : Array.isArray(rawBody.passengers)
      ? rawBody.passengers
      : [rawBody];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cabRes = await client.query(
      `INSERT INTO Cabina (num_cabina, estado, payload_externo)
       VALUES ($1, 'Disponible', $2)
       ON CONFLICT (num_cabina) DO UPDATE SET payload_externo = EXCLUDED.payload_externo
       RETURNING id_cabina`,
      [numCabina, JSON.stringify(rawBody)]
    );
    const idCabina = cabRes.rows[0].id_cabina;

    const savedReservations = [];

    for (let i = 0; i < rawList.length; i++) {
      const p = rawList[i];
      const nombreCompleto = (
        p.nombre_completo ||
        p.nombre ||
        `${p.firstName || p.nombres || ''} ${p.lastName || p.apellidos || ''}`.trim() ||
        `Pasajero ${i + 1}`
      ).slice(0, 100);

      const fechaNacimiento = p.fecha_nacimiento || p.birthDate || '1990-01-01';
      const telefono = p.telefono || p.phone || null;
      const correo = p.correo || p.email || null;
      const nacionalidad = (p.nacionalidad || p.nationality || 'Mexicana').slice(0, 40);

      const paxRes = await client.query(
        `INSERT INTO Pasajero (nombre_completo, fecha_nacimiento, telefono, correo, nacionalidad)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id_pasajero`,
        [nombreCompleto, fechaNacimiento, telefono, correo, nacionalidad]
      );
      const idPasajero = paxRes.rows[0].id_pasajero;

      const numResIndividual = rawList.length === 1 ? baseCode : `${baseCode}-${i + 1}`;

      const resInsert = await client.query(
        `INSERT INTO Reservacion (num_reservacion, id_pasajero, id_cabina, fecha_embarque, fecha_desembarque, estado, payload_externo)
         VALUES ($1, $2, $3, $4, $5, 'Vigente', $6)
         ON CONFLICT (num_reservacion) DO UPDATE SET
           id_pasajero = EXCLUDED.id_pasajero,
           id_cabina = EXCLUDED.id_cabina,
           payload_externo = EXCLUDED.payload_externo
         RETURNING id_reservacion, num_reservacion`,
        [numResIndividual, idPasajero, idCabina, fechaEmbarque, fechaDesembarque, JSON.stringify(rawBody)]
      );

      savedReservations.push({
        id_reservacion: resInsert.rows[0].id_reservacion,
        num_reservacion: resInsert.rows[0].num_reservacion,
        pasajero: nombreCompleto
      });
    }

    await client.query('COMMIT');
    return {
      codigoBase: baseCode,
      totalPasajeros: savedReservations.length,
      reservaciones: savedReservations
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 1.B CONSULTAR RESERVACIONES REGISTRADAS EN NEON (GET /api/check-in/reservations)
export const getAllReservations = async () => {
  const result = await pool.query(
    `SELECT
       r.id_reservacion,
       r.num_reservacion,
       r.fecha_embarque,
       r.fecha_desembarque,
       r.estado AS estado_reservacion,
       p.id_pasajero,
       p.nombre_completo,
       p.fecha_nacimiento,
       p.nacionalidad,
       c.id_cabina,
       c.num_cabina,
       c.estado AS estado_cabina,
       rc.id_registro AS id_checkin,
       rc.estado AS estado_checkin,
       rc.qr_payload
     FROM Reservacion r
     JOIN Pasajero p ON r.id_pasajero = p.id_pasajero
     LEFT JOIN Cabina c ON r.id_cabina = c.id_cabina
     LEFT JOIN Registro_checkin rc ON r.id_reservacion = rc.id_reservacion
     ORDER BY r.id_reservacion DESC`
  );
  return result.rows;
};

// 2. INICIAR CHECK-IN (ST01)
export const initiateCheckIn = async (data) => {
  const code = data.groupCode.trim().toUpperCase();

  const resQuery = await pool.query(
    `SELECT r.id_reservacion, r.num_reservacion, r.id_cabina, p.nombre_completo, p.fecha_nacimiento
     FROM Reservacion r
     JOIN Pasajero p ON r.id_pasajero = p.id_pasajero
     WHERE r.num_reservacion = $1 OR r.num_reservacion LIKE $2`,
    [code, `${code}-%`]
  );

  if (resQuery.rows.length === 0) {
    const error = new Error('Reservation not found');
    error.code = 'ERR_RESERVATION_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  let hasAdult = false;
  let hasMinor = false;
  for (const row of resQuery.rows) {
    const age = new Date().getFullYear() - new Date(row.fecha_nacimiento).getFullYear();
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
    for (const row of resQuery.rows) {
      const existing = await client.query(
        'SELECT id_registro FROM Registro_checkin WHERE id_reservacion = $1',
        [row.id_reservacion]
      );
      let idRegistro;
      if (existing.rows.length > 0) {
        idRegistro = existing.rows[0].id_registro;
      } else {
        const ins = await client.query(
          `INSERT INTO Registro_checkin (id_reservacion, id_cabina, estado)
           VALUES ($1, $2, 'En proceso')
           RETURNING id_registro`,
          [row.id_reservacion, row.id_cabina]
        );
        idRegistro = ins.rows[0].id_registro;

        await client.query(
          `INSERT INTO cuenta (id_registro, estado) VALUES ($1, 'Abierta')`,
          [idRegistro]
        );
      }
      checkInIds.push(idRegistro);
    }
    await client.query('COMMIT');
    return { groupCode: code, checkInIds };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 3. CONFIRMAR CON RESERVACIONES (ST05) CON TOLERANCIA A FALLOS (FALLBACK)
export const sendToReservations = async (checkInId) => {
  const regRes = await pool.query(
    `SELECT rc.id_registro, r.num_reservacion, p.nombre_completo
     FROM Registro_checkin rc
     JOIN Reservacion r ON rc.id_reservacion = r.id_reservacion
     JOIN Pasajero p ON r.id_pasajero = p.id_pasajero
     WHERE rc.id_registro = $1`,
    [Number(checkInId) || 0]
  );

  const info = regRes.rows[0] || { id_registro: checkInId };
  const targetUrl = process.env.RESERVATIONS_URL || RESERVATIONS_URL;

  try {
    const data = await fetchExternalService(targetUrl, {
      method: 'POST',
      body: JSON.stringify({
        checkInId,
        num_reservacion: info.num_reservacion,
        nombre_completo: info.nombre_completo,
        status: 'PENDING_CONFIRMATION'
      })
    });

    if (data.success === false || data.validado === false) {
      const error = new Error('Reservaciones rechazó el Check-in');
      error.code = 'ERR_RESERVATION_REJECTED';
      error.statusCode = 400;
      throw error;
    }
    return { ...data, fallbackMode: false };
  } catch (err) {
    if (err.code === 'ERR_RESERVATION_REJECTED' || err.isBusinessRejection) {
      throw err;
    }
    console.warn(`[FALLBACK RESERVACIONES] Servicio no disponible (${err.message}). Continuando en modo contingencia.`);
    return {
      success: true,
      fallbackMode: true,
      syncStatus: 'PENDING_SYNC',
      message: 'Microservicio de Reservaciones no disponible: validación local aprobada con sincronización pendiente.'
    };
  }
};

// 4. PROCESAR PAGO (ST04) CON TOLERANCIA A FALLOS (FALLBACK -> DEPOSITO PENDIENTE)
export const processPayment = async (data) => {
  const { checkInId, amount, documentNumber } = data;
  const idRegistro = Number(checkInId);
  const targetUrl = process.env.BANK_URL || BANK_URL;

  let result = null;
  let isBankOffline = false;

  try {
    result = await fetchExternalService(targetUrl, {
      method: 'POST',
      body: JSON.stringify({ amount, document: documentNumber })
    });

    if (result.success === false) {
      const error = new Error('Payment declined');
      error.code = 'ERR_PAYMENT_PENDING';
      error.statusCode = 402;
      throw error;
    }
  } catch (err) {
    if (err.code === 'ERR_PAYMENT_PENDING' || err.isBusinessRejection) {
      throw err;
    }
    console.warn(`[FALLBACK BANCO] Banco caído (${err.message}). Registrando cobro como PENDIENTE.`);
    isBankOffline = true;
    result = {
      fallback: true,
      status: 'PENDIENTE_BANCO',
      reason: err.message
    };
  }

  const estadoDeposito = isBankOffline ? 'Pendiente' : 'Aprobado';
  const folio = isBankOffline
    ? `PEND-${Date.now()}`.slice(0, 30)
    : String(result.transactionId || result.noTr || `FOL-${Date.now()}`).slice(0, 30);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ctaRes = await client.query('SELECT id_cuenta FROM cuenta WHERE id_registro = $1 LIMIT 1', [idRegistro]);
    const idCuenta = ctaRes.rows[0]?.id_cuenta || (
      await client.query("INSERT INTO cuenta (id_registro, estado) VALUES ($1, 'Abierta') RETURNING id_cuenta", [idRegistro])
    ).rows[0].id_cuenta;

    const cargoRes = await client.query(
      `INSERT INTO cargo (id_cuenta, descripcion, monto)
       VALUES ($1, 'Pago Check-in', $2)
       RETURNING id_cargo`,
      [idCuenta, amount]
    );

    const cobroRes = await client.query(
      `INSERT INTO cobro (id_cargo, forma_pago, ultimos4, monto)
       VALUES ($1, 'Tarjeta', $2, $3)
       RETURNING id_cobro`,
      [cargoRes.rows[0].id_cargo, String(documentNumber).slice(-4), amount]
    );

    await client.query(
      `INSERT INTO deposito (id_cobro, monto, estado, folio_confirmacion, fecha_respuesta, payload_externo)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)`,
      [cobroRes.rows[0].id_cobro, amount, estadoDeposito, folio, JSON.stringify(result)]
    );

    await client.query(
      `INSERT INTO comprobante (id_cuenta, monto_cobrado, folio_deposito)
       VALUES ($1, $2, $3)`,
      [idCuenta, isBankOffline ? 0 : amount, folio]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    message: isBankOffline
      ? 'Banco no disponible: cobro registrado como PENDIENTE en la cuenta del pasajero.'
      : 'Payment processed successfully',
    paymentStatus: estadoDeposito,
    fallbackMode: isBankOffline,
    folio,
    externalResponse: result
  };
};

// 5. CONSULTAR Y ASIGNAR CABINA (ST06) CON TOLERANCIA A FALLOS (FALLBACK)
export const assignCabin = async (data) => {
  const { checkInId, cabinId } = data;
  const idRegistro = Number(checkInId);
  const numCabina = String(cabinId).trim().slice(0, 10);
  const targetUrl = process.env.CABIN_AVAILABILITY_URL || CABIN_AVAILABILITY_URL;

  let result = null;
  let isCabinServiceOffline = false;

  try {
    result = await fetchExternalService(`${targetUrl}/${encodeURIComponent(numCabina)}`);
    if (result.success === false || result.available === false) {
      const error = new Error('Cabin is full or not found');
      error.code = 'ERR_CABIN_FULL';
      error.statusCode = 409;
      throw error;
    }
  } catch (err) {
    if (err.code === 'ERR_CABIN_FULL' || err.isBusinessRejection) {
      throw err;
    }
    console.warn(`[FALLBACK CABINAS] Servicio de Cabinas no disponible (${err.message}). Asignando localmente.`);
    isCabinServiceOffline = true;
    result = { fallback: true, cabin: numCabina, reason: err.message };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cabRes = await client.query(
      `INSERT INTO Cabina (num_cabina, estado, payload_externo)
       VALUES ($1, 'Ocupada', $2)
       ON CONFLICT (num_cabina) DO UPDATE SET estado = 'Ocupada', payload_externo = EXCLUDED.payload_externo
       RETURNING id_cabina`,
      [numCabina, JSON.stringify(result)]
    );
    const idCabina = cabRes.rows[0].id_cabina;

    await client.query(
      `INSERT INTO Solicitud_cabina (id_registro, id_cabina, resultado, fecha_respuesta)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [idRegistro, idCabina, isCabinServiceOffline ? 'Pendiente Sync' : 'Asignada']
    );

    await client.query(
      `UPDATE Registro_checkin SET id_cabina = $1, estado = 'En proceso' WHERE id_registro = $2`,
      [idCabina, idRegistro]
    );

    await client.query('COMMIT');
    return {
      message: isCabinServiceOffline
        ? 'Cabinas no disponible: cabina asignada localmente (sincronización pendiente).'
        : 'Cabin assigned successfully',
      fallbackMode: isCabinServiceOffline,
      id_cabina: idCabina,
      num_cabina: numCabina
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const getCabins = async () => {
  const result = await pool.query('SELECT id_cabina, num_cabina, estado FROM Cabina');
  return result.rows;
};

// 6. GENERAR QR (SU02) Y NOTIFICAR DATOS_PASAJERO A EMBARQUE (CHK-EMB)
export const generateQR = async (checkInId) => {
  const idRegistro = Number(checkInId);
  const checkInResult = await pool.query(
    `SELECT rc.estado, rc.qr_payload, r.num_reservacion, p.nombre_completo, c.num_cabina,
            (SELECT pe.descripcion
             FROM Envio_equipaje ee
             JOIN Pieza_equipaje pe ON ee.id_envio = pe.id_envio
             WHERE ee.id_registro = rc.id_registro
             LIMIT 1) AS tipo_equipaje
     FROM Registro_checkin rc
     LEFT JOIN Reservacion r ON rc.id_reservacion = r.id_reservacion
     LEFT JOIN Pasajero p ON r.id_pasajero = p.id_pasajero
     LEFT JOIN Cabina c ON rc.id_cabina = c.id_cabina
     WHERE rc.id_registro = $1`,
    [idRegistro]
  );

  if (checkInResult.rows.length === 0) {
    const e = new Error('Check-in not found');
    e.code = 'ERR_NOT_FOUND';
    e.statusCode = 404;
    throw e;
  }

  const checkIn = checkInResult.rows[0];
  const publicHost = ['sierra-madre-checkin', 'onrender', 'com'].join('.');
  const defaultBaseUrl = `https://${publicHost}`;
  const rawPublicUrl = (process.env.PUBLIC_URL || '').trim();
  const baseUrl = rawPublicUrl && !rawPublicUrl.endsWith('://onrender.com')
    ? rawPublicUrl.replace(/\/$/, '')
    : defaultBaseUrl;
  const payload = `${baseUrl}/api/check-in/boarding-pass/${idRegistro}`;
  const qrBase64 = await QRCode.toDataURL(payload);
  await pool.query('UPDATE Registro_checkin SET qr_payload = $1 WHERE id_registro = $2', [qrBase64, idRegistro]);

  const datosPasajero = {
    evento: 'DATOS_PASAJERO',
    noCabina: checkIn.num_cabina || 'PENDIENTE',
    horaRecepcion: new Date().toISOString(),
    noReservacion: checkIn.num_reservacion || `RES-${idRegistro}`,
    nombreCompleto: checkIn.nombre_completo || 'Pasajero',
    tipoEquipaje: checkIn.tipo_equipaje || 'Sin equipaje registrado',
    estado: checkIn.estado || 'En proceso'
  };

  const targetBoardingUrl = process.env.BOARDING_URL || BOARDING_URL;
  let boardingSync = { sent: false, status: 'SKIPPED_NO_URL' };

  if (targetBoardingUrl) {
    try {
      const extResp = await fetchExternalService(targetBoardingUrl, {
        method: 'POST',
        body: JSON.stringify(datosPasajero)
      });
      boardingSync = { sent: true, status: 'DELIVERED', response: extResp };
    } catch (syncErr) {
      console.warn(`[WARN EMBARQUE] No se pudo notificar a ${targetBoardingUrl}:`, syncErr.message);
      boardingSync = { sent: false, status: 'UNREACHABLE', error: syncErr.message };
    }
  }

  return { qrBase64, boardingPassUrl: payload, datosPasajero, boardingSync };
};

// 7. REGISTRAR EQUIPAJE (ST07) -> Envio_equipaje + Pieza_equipaje
export const registerLuggage = async (data) => {
  const { checkInId, bagCount, totalWeightKg, isVip } = data;
  const idRegistro = Number(checkInId);

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const regRes = await client.query('SELECT id_cabina FROM Registro_checkin WHERE id_registro = $1', [idRegistro]);
    if (regRes.rows.length === 0) {
      const e = new Error('Check-in not found');
      e.code = 'ERR_NOT_FOUND';
      e.statusCode = 404;
      throw e;
    }

    const idCabina = regRes.rows[0].id_cabina;
    const envRes = await client.query(
      `INSERT INTO Envio_equipaje (id_registro, id_cabina, estado)
       VALUES ($1, $2, 'Enviado')
       RETURNING id_envio`,
      [idRegistro, idCabina]
    );
    const idEnvio = envRes.rows[0].id_envio;

    for (let i = 1; i <= Math.max(1, bagCount); i++) {
      await client.query(
        `INSERT INTO Pieza_equipaje (id_envio, etiqueta, descripcion, estado)
         VALUES ($1, $2, $3, 'Registrada')`,
        [idEnvio, `TAG-${idRegistro}-${i}`, `Maleta ${i} (${totalWeightKg} kg total)`]
      );
    }

    await client.query('COMMIT');
    return { message: 'Luggage registered successfully', id_envio: idEnvio, extraFee };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 8. CHECK-OUT (ST08 - ST12) CON TOLERANCIA A FALLOS EN CABINAS Y BANCO
export const processCheckout = async (checkInId, documentNumber) => {
  const idRegistro = Number(checkInId);
  const result = await pool.query(
    `SELECT rc.id_cabina, c.num_cabina
     FROM Registro_checkin rc
     JOIN Cabina c ON rc.id_cabina = c.id_cabina
     WHERE rc.id_registro = $1`,
    [idRegistro]
  );

  if (result.rows.length === 0) {
    const e = new Error('Check-in or cabin not found');
    e.code = 'ERR_NO_CABIN';
    e.statusCode = 400;
    throw e;
  }

  const { id_cabina: idCabina, num_cabina: numCabina } = result.rows[0];
  const targetCabinCheckoutUrl = process.env.CABIN_CHECKOUT_URL || CABIN_CHECKOUT_URL;
  const targetBankUrl = process.env.BANK_URL || BANK_URL;

  let cabinReport;
  let cabinOffline = false;
  try {
    cabinReport = await fetchExternalService(`${targetCabinCheckoutUrl}/${encodeURIComponent(numCabina)}`);
  } catch (err) {
    console.warn(`[FALLBACK CHECKOUT CABINAS] Cabinas no disponible (${err.message}). Inspección marcada pendiente.`);
    cabinOffline = true;
    cabinReport = {
      hasCharges: false,
      amount: 0,
      encargado: 'Contingencia Check-out',
      reason: 'Microservicio Cabinas no disponible al momento del Check-out (Pendiente verificación)'
    };
  }

  const hasCharges = Boolean(cabinReport.hasCharges && cabinReport.amount > 0);
  const client = await pool.connect();
  let chargeMessage = cabinOffline
    ? 'Check-out completado (inspección de Cabinas pendiente de sincronización).'
    : 'Check-out successful. No extra charges.';
  let pendingCharge = false;

  try {
    await client.query('BEGIN');
    const repRes = await client.query(
      `INSERT INTO reporte_estado (id_registro, id_cabina, encargado, existen_danos, descripcion, payload_externo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_report_estado`,
      [
        idRegistro,
        idCabina,
        (cabinReport.encargado || 'Inspección Cabinas').slice(0, 100),
        hasCharges,
        (cabinReport.reason || cabinReport.descripcion || 'Sin novedades').slice(0, 250),
        JSON.stringify(cabinReport)
      ]
    );
    const idReportEstado = repRes.rows[0].id_report_estado;

    const ctaRes = await client.query('SELECT id_cuenta FROM cuenta WHERE id_registro = $1 LIMIT 1', [idRegistro]);
    const idCuenta = ctaRes.rows[0]?.id_cuenta || (
      await client.query("INSERT INTO cuenta (id_registro, estado) VALUES ($1, 'Abierta') RETURNING id_cuenta", [idRegistro])
    ).rows[0].id_cuenta;

    if (hasCharges) {
      let bankResult;
      let bankOffline = false;
      try {
        bankResult = await fetchExternalService(targetBankUrl, {
          method: 'POST',
          body: JSON.stringify({ amount: cabinReport.amount, document: documentNumber })
        });
        if (bankResult.success === false) {
          const e = new Error('Extra charges declined');
          e.code = 'ERR_PAYMENT_PENDING';
          e.statusCode = 402;
          throw e;
        }
      } catch (bankErr) {
        if (bankErr.code === 'ERR_PAYMENT_PENDING' || bankErr.isBusinessRejection) {
          throw bankErr;
        }
        console.warn(`[FALLBACK CHECKOUT BANCO] Banco caído (${bankErr.message}). Dejando cobro de $${cabinReport.amount} PENDIENTE.`);
        bankOffline = true;
        pendingCharge = true;
        bankResult = { fallback: true, status: 'PENDIENTE_BANCO', reason: bankErr.message };
      }

      const estadoDeposito = bankOffline ? 'Pendiente' : 'Aprobado';
      const folio = bankOffline
        ? `PEND-${Date.now()}`.slice(0, 30)
        : String(bankResult.transactionId || bankResult.noTr || `FOL-${Date.now()}`).slice(0, 30);

      const cargoRes = await client.query(
        `INSERT INTO cargo (id_cuenta, id_report_estado, descripcion, monto)
         VALUES ($1, $2, $3, $4)
         RETURNING id_cargo`,
        [idCuenta, idReportEstado, (cabinReport.reason || 'Cargo Check-out').slice(0, 250), cabinReport.amount]
      );

      const cobroRes = await client.query(
        `INSERT INTO cobro (id_cargo, forma_pago, ultimos4, monto)
         VALUES ($1, 'Tarjeta', $2, $3)
         RETURNING id_cobro`,
        [cargoRes.rows[0].id_cargo, String(documentNumber).slice(-4), cabinReport.amount]
      );

      await client.query(
        `INSERT INTO deposito (id_cobro, monto, estado, folio_confirmacion, fecha_respuesta, payload_externo)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)`,
        [cobroRes.rows[0].id_cobro, cabinReport.amount, estadoDeposito, folio, JSON.stringify(bankResult)]
      );

      await client.query(
        `INSERT INTO comprobante (id_cuenta, monto_cobrado, folio_deposito)
         VALUES ($1, $2, $3)`,
        [idCuenta, bankOffline ? 0 : cabinReport.amount, folio]
      );

      chargeMessage = bankOffline
        ? `Check-out registrado con COBRO PENDIENTE de $${cabinReport.amount} (Banco no disponible: ${cabinReport.reason}).`
        : `Check-out successful. Extra charge of $${cabinReport.amount} processed for: ${cabinReport.reason}`;
    }

    const estadoCuentaFinal = pendingCharge ? 'Pendiente' : 'Cerrada';
    await client.query(
      `UPDATE cuenta SET estado = $1, fecha_cierre = CURRENT_TIMESTAMP WHERE id_cuenta = $2`,
      [estadoCuentaFinal, idCuenta]
    );
    await client.query("UPDATE Cabina SET estado = 'Disponible' WHERE id_cabina = $1", [idCabina]);
    await client.query("UPDATE Registro_checkin SET estado = 'Completado' WHERE id_registro = $1", [idRegistro]);

    await client.query('COMMIT');
    return { message: chargeMessage, pendingCharge, fallbackMode: cabinOffline || pendingCharge };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 9. PASE DE ABORDAR
export const getBoardingPassData = async (checkInId) => {
  const res = await pool.query(
    `SELECT rc.id_registro AS id, rc.estado AS status, p.nombre_completo, c.num_cabina AS cabin_number, r.num_reservacion AS group_code
     FROM Registro_checkin rc
     JOIN Reservacion r ON rc.id_reservacion = r.id_reservacion
     JOIN Pasajero p ON r.id_pasajero = p.id_pasajero
     LEFT JOIN Cabina c ON rc.id_cabina = c.id_cabina
     WHERE rc.id_registro = $1`,
    [Number(checkInId) || 0]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
};