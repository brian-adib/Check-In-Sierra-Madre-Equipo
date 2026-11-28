import { pool } from '../db/client.js';
import QRCode from 'qrcode';

const RESERVATIONS_URL = process.env.RESERVATIONS_URL || 'http://localhost:3001/api/reservations/confirm';
const BANK_URL = process.env.BANK_URL || 'http://localhost:3002/api/bank/charge';
const CABIN_AVAILABILITY_URL = process.env.CABIN_AVAILABILITY_URL || 'http://localhost:3003/api/cabins/availability';
const CABIN_CHECKOUT_URL = process.env.CABIN_CHECKOUT_URL || 'http://localhost:3003/api/cabins/checkout-report';
const BOARDING_URL = process.env.BOARDING_URL || '';
const LUGGAGE_URL = process.env.LUGGAGE_URL || '';

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

function safeIsoDate(val, fallbackDate = new Date()) {
  if (!val) return fallbackDate.toISOString().slice(0, 10);
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? fallbackDate.toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

// 1. ADAPTADOR TOLERANTE (Interfaz 8 RSV_VENDIDA + Esquema MongoDB Reservaciones)

export const receiveExternalReservation = async (rawBody) => {
  const root =
    rawBody?.data && typeof rawBody.data === 'object' && !Array.isArray(rawBody.data)
      ? { ...rawBody, ...rawBody.data }
      : rawBody;

  const resObj = root.reservacion && typeof root.reservacion === 'object' ? root.reservacion : root;
  const cliObj = root.cliente && typeof root.cliente === 'object' ? root.cliente : root;
  const viajeObj = root.viaje && typeof root.viaje === 'object' ? root.viaje : root;

  const baseCode = String(
    resObj.Folio_reservacion ||
      resObj.folio_reservacion ||
      resObj.folio ||
      resObj.num_reservacion ||
      resObj.clave_reserva ||
      resObj.reservationCode ||
      resObj.groupCode ||
      resObj._id ||
      `RES-${Date.now()}`
  )
    .trim()
    .toUpperCase();

  const idCabinaExt = resObj.Id_cabina || resObj.id_cabina || resObj.idCabina || null;
  const categoriaTipo =
    (
      resObj.categoriaTipo ||
      resObj.tipoCamarote ||
      resObj.Paquete ||
      resObj.paquete ||
      null
    )
      ?.toString()
      .slice(0, 50) || null;

  const rawCabina =
    resObj.numeroCabina ||
    resObj.num_cabina ||
    resObj.cabina ||
    resObj.cabinNumber ||
    idCabinaExt ||
    resObj.tipoCamarote ||
    'PENDIENTE';
    const numCabina = String(rawCabina).trim().slice(0, 40);

  const salidaRaw =
    resObj.Fecha_salida || resObj.fecha_salida || resObj.fecha_embarque || viajeObj.fechaSalida || resObj.embarkDate;
  const fechaEmbarque = safeIsoDate(salidaRaw);

  const diasViaje = Number(viajeObj.duracionDias || resObj.duracionDias || 7);
  const regresoRaw = resObj.Fecha_regreso || resObj.fecha_regreso || resObj.fecha_desembarque || resObj.disembarkDate;
  const fechaDesembarque = safeIsoDate(regresoRaw, new Date(new Date(fechaEmbarque).getTime() + diasViaje * 86400000));


  const idEventoTour =
    (resObj['Id_evento/Id_tour'] || resObj.Id_evento || resObj.Id_tour || viajeObj._id || resObj.viaje || null)
      ?.toString()
      .slice(0, 60) || null;
  const nombreViaje =
    (resObj.Nombre_viaje || resObj.nombre_viaje || viajeObj.destino || resObj.destino || null)
      ?.toString()
      .slice(0, 120) || null;
  const puertoSalida =
    (resObj.Puerto_salida || resObj.puerto_salida || viajeObj.puertoSalida || null)?.toString().slice(0, 80) || null;
  const paquete = (resObj.Paquete || resObj.paquete || resObj.tipoCamarote || null)?.toString().slice(0, 80) || null;
  const numHuespedes = Math.max(1, Number(resObj.Num_huespedes || resObj.num_huespedes || resObj.numeroPasajeros || 1));
  const totalMonto =
    resObj.Total !== undefined ? Number(resObj.Total) : resObj.importe !== undefined ? Number(resObj.importe) : null;
  const fechaEmision = resObj.Fecha_emision || resObj.fecha_emision || resObj.createdAt || new Date().toISOString();
  const estatusRaw = String(resObj.Estatus || resObj.estado || 'Vigente').slice(0, 20);
  const tarjRaw = String(resObj.Num_tarj || resObj.num_tarj || resObj.pago?.numeroTarjeta || '').replace(/\D/g, '');
  const ultimos4Tarj = tarjRaw.length >= 4 ? tarjRaw.slice(-4) : null;

  let rawList = Array.isArray(root.pasajeros)
    ? root.pasajeros
    : Array.isArray(root.passengers)
    ? root.passengers
    : null;

  if (!rawList) {
    const titular = {
      id_cliente: cliObj._id || resObj.Id_cliente || resObj.id_cliente || resObj.cliente || null,
      nombre_completo: cliObj.nombreCompleto || cliObj.nombre_completo || cliObj.nombre || 'Titular Reserva',
      identificacion: cliObj.identificacion || null,
      telefono: cliObj.telefono || null,
      correo: cliObj.email || cliObj.correo || null,
      domicilio: cliObj.domicilio || null,
      fecha_nacimiento: cliObj.fechaNacimiento || cliObj.fecha_nacimiento || '1990-01-01',
      nacionalidad: cliObj.nacionalidad || 'Mexicana',
    };
    rawList = [titular];
    for (let h = 2; h <= numHuespedes; h++) {
      rawList.push({
        id_cliente: titular.id_cliente ? `${titular.id_cliente}-A${h}` : null,
        nombre_completo: `Acompañante ${h - 1} (${titular.nombre_completo})`,
        fecha_nacimiento: '1992-01-01',
        nacionalidad: titular.nacionalidad,
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cabRes = await client.query(
      `INSERT INTO Cabina (num_cabina, id_cabina_externo, categoria_tipo, capacidad, estado, payload_externo)
       VALUES ($1, $2, $3, $4, 'Disponible', $5)
       ON CONFLICT (num_cabina) DO UPDATE SET
         id_cabina_externo = COALESCE(EXCLUDED.id_cabina_externo, Cabina.id_cabina_externo),
         categoria_tipo = COALESCE(EXCLUDED.categoria_tipo, Cabina.categoria_tipo),
         capacidad = COALESCE(EXCLUDED.capacidad, Cabina.capacidad),
         payload_externo = EXCLUDED.payload_externo
       RETURNING id_cabina`,
      [numCabina, idCabinaExt ? String(idCabinaExt).slice(0, 60) : null, categoriaTipo, numHuespedes, JSON.stringify(rawBody)]
    );
    const idCabina = cabRes.rows[0].id_cabina;

    const savedReservations = [];

    for (let i = 0; i < rawList.length; i++) {
      const p = rawList[i];
      const nombreCompleto = (
        p.nombre_completo ||
        p.nombreCompleto ||
        p.nombre ||
        `${p.firstName || p.nombres || ''} ${p.lastName || p.apellidos || ''}`.trim() ||
        `Pasajero ${i + 1}`
      ).slice(0, 100);

      const idClienteExt =
        (p.id_cliente || p.Id_cliente || p._id || cliObj._id || resObj.Id_cliente || null)?.toString().slice(0, 60) ||
        null;
      const identificacion = (p.identificacion || cliObj.identificacion || null)?.toString().slice(0, 50) || null;
      const domicilio = (p.domicilio || cliObj.domicilio || null)?.toString().slice(0, 200) || null;
      const fechaNacimiento = p.fecha_nacimiento || p.birthDate || '1990-01-01';
      const telefono = p.telefono || p.phone || null;
      const correo = p.correo || p.email || null;
      const nacionalidad = (p.nacionalidad || p.nationality || 'Mexicana').slice(0, 40);

      const paxRes = await client.query(
        `INSERT INTO Pasajero (nombre_completo, fecha_nacimiento, telefono, correo, nacionalidad, id_cliente_externo, identificacion, domicilio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id_pasajero`,
        [nombreCompleto, fechaNacimiento, telefono, correo, nacionalidad, idClienteExt, identificacion, domicilio]
      );
      const idPasajero = paxRes.rows[0].id_pasajero;

      const numResIndividual = (rawList.length === 1 ? baseCode : `${baseCode}-${i + 1}`).slice(0, 60);


      const resInsert = await client.query(
        `INSERT INTO Reservacion (
           num_reservacion, id_pasajero, id_cabina, fecha_embarque, fecha_desembarque, estado,
           id_evento_tour, nombre_viaje, puerto_salida, paquete, num_huespedes, total, fecha_emision, ultimos4_tarj, payload_externo
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (num_reservacion) DO UPDATE SET
           id_pasajero = EXCLUDED.id_pasajero,
           id_cabina = EXCLUDED.id_cabina,
           fecha_embarque = EXCLUDED.fecha_embarque,
           fecha_desembarque = EXCLUDED.fecha_desembarque,
           estado = EXCLUDED.estado,
           id_evento_tour = COALESCE(EXCLUDED.id_evento_tour, Reservacion.id_evento_tour),
           nombre_viaje = COALESCE(EXCLUDED.nombre_viaje, Reservacion.nombre_viaje),
           puerto_salida = COALESCE(EXCLUDED.puerto_salida, Reservacion.puerto_salida),
           paquete = COALESCE(EXCLUDED.paquete, Reservacion.paquete),
           num_huespedes = EXCLUDED.num_huespedes,
           total = COALESCE(EXCLUDED.total, Reservacion.total),
           ultimos4_tarj = COALESCE(EXCLUDED.ultimos4_tarj, Reservacion.ultimos4_tarj),
           payload_externo = EXCLUDED.payload_externo
         RETURNING id_reservacion, num_reservacion`,
        [
          numResIndividual,
          idPasajero,
          idCabina,
          fechaEmbarque,
          fechaDesembarque,
          estatusRaw,
          idEventoTour,
          nombreViaje,
          puertoSalida,
          paquete,
          numHuespedes,
          totalMonto,
          fechaEmision,
          ultimos4Tarj,
          JSON.stringify(rawBody),
        ]
      );

      savedReservations.push({
        id_reservacion: resInsert.rows[0].id_reservacion,
        num_reservacion: resInsert.rows[0].num_reservacion,
        pasajero: nombreCompleto,
        id_cliente: idClienteExt,
      });
    }

    await client.query('COMMIT');
    return {
      codigoBase: baseCode,
      totalPasajeros: savedReservations.length,
      reservaciones: savedReservations,
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
  const result = await pool.query(`
    SELECT
      r.id_reservacion, r.num_reservacion, r.fecha_embarque, r.fecha_desembarque,
      r.estado AS estado_reservacion, r.nombre_viaje, r.paquete, r.num_huespedes, r.total,
      p.id_pasajero, p.id_cliente_externo, p.nombre_completo, p.identificacion,
      p.fecha_nacimiento, p.nacionalidad,
      c.id_cabina, c.num_cabina, c.categoria_tipo, c.estado AS estado_cabina,
      rc.id_registro AS id_checkin, rc.estado AS estado_checkin, rc.qr_payload
    FROM Reservacion r
    JOIN Pasajero p ON r.id_pasajero = p.id_pasajero
    LEFT JOIN Cabina c ON r.id_cabina = c.id_cabina
    LEFT JOIN Registro_checkin rc ON r.id_reservacion = rc.id_reservacion
    ORDER BY r.id_reservacion DESC
  `);
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

// 3. CONFIRMAR CON RESERVACIONES (Interfaz 11 REGIS_CHK: ID_cliente, id_cabina, tipoEquipaje)
export const sendToReservations = async (checkInId) => {
  const regRes = await pool.query(
    `SELECT
       rc.id_registro, r.num_reservacion, p.id_pasajero, p.id_cliente_externo, p.nombre_completo,
       COALESCE(c.id_cabina_externo, c.num_cabina, rcab.num_cabina, 'PENDIENTE') AS id_cabina_ref,
                   COALESCE(
              (SELECT ee.detalle_piezas->0->>'descripcion' FROM Envio_equipaje ee WHERE ee.id_registro = rc.id_registro ORDER BY ee.id_envio DESC LIMIT 1),
              'Equipaje estándar'
            ) AS tipo_equipaje

     FROM Registro_checkin rc
     JOIN Reservacion r ON rc.id_reservacion = r.id_reservacion
     JOIN Pasajero p ON r.id_pasajero = p.id_pasajero
     LEFT JOIN Cabina c ON rc.id_cabina = c.id_cabina
     LEFT JOIN Cabina rcab ON r.id_cabina = rcab.id_cabina
     WHERE rc.id_registro = $1`,
    [Number(checkInId) || 0]
  );

  const info = regRes.rows[0] || { id_registro: checkInId };
  const targetUrl = process.env.RESERVATIONS_URL || RESERVATIONS_URL;

  const payloadRegisChk = {
    ID_cliente: info.id_cliente_externo || String(info.id_pasajero || checkInId),
    id_cabina: info.id_cabina_ref || 'PENDIENTE',
    tipoEquipaje: info.tipo_equipaje || 'Equipaje estándar',
    checkInId,
    num_reservacion: info.num_reservacion,
    nombre_completo: info.nombre_completo,
    status: 'PENDING_CONFIRMATION',
  };

  try {
    const data = await fetchExternalService(targetUrl, {
      method: 'POST',
      body: JSON.stringify(payloadRegisChk),
    });

    if (data.success === false || data.validado === false) {
      const error = new Error('Reservaciones rechazó el Check-in');
      error.code = 'ERR_RESERVATION_REJECTED';
      error.statusCode = 400;
      throw error;
    }

    return { ...data, sentPayload: payloadRegisChk, fallbackMode: false };
  } catch (err) {
    if (err.code === 'ERR_RESERVATION_REJECTED' || err.isBusinessRejection) {
      throw err;
    }
    console.warn(`[FALLBACK RESERVACIONES] Servicio no disponible (${err.message}). Continuando en modo contingencia.`);
    return {
      success: true,
      fallbackMode: true,
      syncStatus: 'PENDING_SYNC',
      sentPayload: payloadRegisChk,
      message: 'Microservicio de Reservaciones no disponible: validación local aprobada con sincronización pendiente.',
    };
  }
};

// 4. PROCESAR PAGO (Interfaces 1 y 2 DATOS_TRANS / EDO_TRANS)
export const processPayment = async (data) => {
  const { checkInId, amount, documentNumber, ctaDest = 'CUENTA-CRUCERO', cvv = '123' } = data;
  const idRegistro = Number(checkInId);
  const targetUrl = process.env.BANK_URL || BANK_URL;

  let result = null;
  let isBankOffline = false;

  try {
    // CONTRATO EXACTO DE LA MATRIZ (Interfaz 1)
    result = await fetchExternalService(targetUrl, {
      method: 'POST',
      body: JSON.stringify({
        numTarjeta: documentNumber,
        nomCompleto: 'Pasajero Check-in', 
        CVV: cvv,
        ctaDest: ctaDest,
        Monto: amount
      })
    });

    if (result.success === false) {
      const error = new Error('Payment declined');
      error.code = 'ERR_PAYMENT_PENDING';
      error.statusCode = 402;
      throw error;
    }
  } catch (err) {
    if (err.code === 'ERR_PAYMENT_PENDING' || err.isBusinessRejection) throw err;
    console.warn(`[FALLBACK BANCO] Banco caído (${err.message}). Registrando cobro como PENDIENTE.`);
    isBankOffline = true;
    result = { fallback: true, status: 'PENDIENTE_BANCO', reason: err.message };
  }

  const estadoDeposito = isBankOffline ? 'Pendiente' : 'Aprobado';
  const folio = isBankOffline ? `PEND-${Date.now()}` : String(result.noTr || result.transactionId || `FOL-${Date.now()}`).slice(0, 30);
  const edoTr = result.edoTr || estadoDeposito; // Guardar respuesta oficial EDO_TRANS

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ctaRes = await client.query('SELECT id_cuenta FROM cuenta WHERE id_registro = $1 LIMIT 1', [idRegistro]);
    const idCuenta = ctaRes.rows[0]?.id_cuenta || (
      await client.query("INSERT INTO cuenta (id_registro, estado) VALUES ($1, 'Abierta') RETURNING id_cuenta", [idRegistro])
    ).rows[0].id_cuenta;

    const cargoRes = await client.query(
      `INSERT INTO cargo (id_cuenta, descripcion, monto) VALUES ($1, 'Pago Check-in', $2) RETURNING id_cargo`,
      [idCuenta, amount]
    );

    const cobroRes = await client.query(
      `INSERT INTO cobro (id_cargo, forma_pago, ultimos4, monto) VALUES ($1, 'Tarjeta', $2, $3) RETURNING id_cobro`,
      [cargoRes.rows[0].id_cargo, String(documentNumber).slice(-4), amount]
    );

    await client.query(
      `INSERT INTO deposito (id_cobro, monto, estado, folio_confirmacion, fecha_respuesta, payload_externo, edo_trans, cta_dest) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7)`,
      [cobroRes.rows[0].id_cobro, amount, estadoDeposito, folio, JSON.stringify(result), edoTr, ctaDest]
    );

    await client.query(
      `INSERT INTO comprobante (id_cuenta, monto_cobrado, folio_deposito) VALUES ($1, $2, $3)`,
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
    message: isBankOffline ? 'Banco no disponible: cobro registrado como PENDIENTE.' : 'Payment processed successfully',
    paymentStatus: estadoDeposito,
    fallbackMode: isBankOffline,
    folio,
    externalResponse: result
  };
};

// 5. CONSULTAR Y ASIGNAR CABINA (Interfaz 7 DISPONIBILIDAD_CABINAS)
export const assignCabin = async (data) => {
  const { checkInId, cabinId } = data;
  const idRegistro = Number(checkInId);
  const numCabina = String(cabinId).trim().slice(0, 40);
  const targetUrl = process.env.CABIN_AVAILABILITY_URL || CABIN_AVAILABILITY_URL;

  let result = null;
  let isCabinServiceOffline = false;

  try {
    result = await fetchExternalService(`${targetUrl}/${encodeURIComponent(numCabina)}`);
    const unavailableByMatrix =
      result.enMantenimiento === true ||
      result.enlazableReserva === false ||
      (result.estatusOperativo &&
        !['DISPONIBLE', 'ACTIVA', 'OPERATIVA'].includes(String(result.estatusOperativo).toUpperCase()));

    if (result.success === false || result.available === false || unavailableByMatrix) {
      const error = new Error('Cabin is full, in maintenance, or not available');
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
      `INSERT INTO Cabina (
         num_cabina, id_cabina_externo, categoria_tipo, capacidad, estatus_operativo,
         en_mantenimiento, enlazable_reserva, estado, payload_externo
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Ocupada', $8)
       ON CONFLICT (num_cabina) DO UPDATE SET
         id_cabina_externo = COALESCE(EXCLUDED.id_cabina_externo, Cabina.id_cabina_externo),
         categoria_tipo = COALESCE(EXCLUDED.categoria_tipo, Cabina.categoria_tipo),
         capacidad = COALESCE(EXCLUDED.capacidad, Cabina.capacidad),
         estatus_operativo = COALESCE(EXCLUDED.estatus_operativo, Cabina.estatus_operativo),
         en_mantenimiento = EXCLUDED.en_mantenimiento,
         enlazable_reserva = EXCLUDED.enlazable_reserva,
         estado = 'Ocupada',
         payload_externo = EXCLUDED.payload_externo
       RETURNING id_cabina`,
      [
        numCabina,
        result.idCabina ? String(result.idCabina).slice(0, 60) : null,
        result.categoriaTipo ? String(result.categoriaTipo).slice(0, 50) : null,
        result.capacidad !== undefined ? Number(result.capacidad) : null,
        result.estatusOperativo
          ? String(result.estatusOperativo).slice(0, 40)
          : isCabinServiceOffline
          ? 'Pendiente Sync'
          : 'Ocupada',
        Boolean(result.enMantenimiento),
        result.enlazableReserva !== undefined ? Boolean(result.enlazableReserva) : true,
        JSON.stringify(result),
      ]
    );
    const idCabina = cabRes.rows[0].id_cabina;

    await client.query(
      `INSERT INTO Solicitud_cabina (id_registro, id_cabina, resultado, fecha_respuesta)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [idRegistro, idCabina, isCabinServiceOffline ? 'Pendiente Sync' : 'Asignada']
    );

    await client.query(`UPDATE Registro_checkin SET id_cabina = $1, estado = 'En proceso' WHERE id_registro = $2`, [
      idCabina,
      idRegistro,
    ]);

    await client.query('COMMIT');
    return {
      message: isCabinServiceOffline
        ? 'Cabinas no disponible: cabina asignada localmente (sincronización pendiente).'
        : 'Cabin assigned successfully',
      fallbackMode: isCabinServiceOffline,
      id_cabina: idCabina,
      num_cabina: numCabina,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const getCabins = async () => {
  const result = await pool.query('SELECT id_cabina, num_cabina, categoria_tipo, capacidad, estado FROM Cabina');
  return result.rows;
};

// 6. GENERAR QR (SU02) Y NOTIFICAR INTERFAZ 10 DATOS_PASAJERO A E9 (EQUIPAJE / EMBARQUE)
export const generateQR = async (checkInId) => {
  
  const idRegistro = Number(checkInId);
  
  
  // Hacemos JOIN con Pasajero para obtener el id_cliente_externo (Interfaz 10)
  const checkInResult = await pool.query(
    `SELECT rc.estado, rc.qr_payload, r.num_reservacion, p.nombre_completo, c.num_cabina, p.id_cliente_externo 
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
  const baseUrl = process.env.PUBLIC_URL || 'https://sierra-madre-checkin.onrender.com';
  const payload = `${baseUrl}/api/check-in/boarding-pass/${idRegistro}`;
  const qrBase64 = await QRCode.toDataURL(payload);
  
  await pool.query('UPDATE Registro_checkin SET qr_payload = $1 WHERE id_registro = $2', [qrBase64, idRegistro]);

  // CONTRATO EXACTO DE LA MATRIZ (Interfaz 10)
  const datosPasajero = {
    id_cabina: checkIn.num_cabina || 'PENDIENTE',
    horaRecepcion: new Date().toISOString(),
    noReservacion: checkIn.num_reservacion || `RES-${idRegistro}`,
    nombreCompleto: checkIn.nombre_completo || 'Pasajero',
    tipoEquipaje: 'General', // Opcional mandar detalle
    estado: checkIn.estado || 'En proceso',
    id_cliente: checkIn.id_cliente_externo || 'CLIENTE-DEMO'
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

// 7. REGISTRAR EQUIPAJE (ST07 + Interfaz 10 DATOS_PASAJERO sin kilos hacia E9 Equipaje)
export const registerLuggage = async (data) => {
  const { checkInId, bagCount, totalWeightKg, isVip, pieces } = data;
  const idRegistro = Number(checkInId);
  const listaPiezas = Array.isArray(pieces) && pieces.length > 0 ? pieces : null;
  const cantidadPiezas = listaPiezas ? listaPiezas.length : Math.max(0, Number(bagCount) || 0);
  const pesoTotal = Number(totalWeightKg) || 0;


  let extraFee = 0;
  if (!isVip) {
    const extraBags = Math.max(0, cantidadPiezas - 1);
    const extraWeight = Math.max(0, pesoTotal - 20);
    extraFee = extraBags * 10 + extraWeight * 10;
  }

  if (extraFee > 0) {
    const e = new Error('Luggage limit exceeded');
    e.code = 'ERR_LUGGAGE_LIMIT';
    e.statusCode = 422;
    throw e;
  }

  const client = await pool.connect();
  let idEnvio;
  let piezasRegistradas = [];
  let infoRegistro = null;

  try {
    await client.query('BEGIN');

    const regRes = await client.query(
      `SELECT
         rc.id_cabina, rc.estado, r.num_reservacion, p.id_pasajero, p.id_cliente_externo, p.nombre_completo,
         COALESCE(c.num_cabina, rcab.num_cabina, 'PENDIENTE') AS num_cabina
       FROM Registro_checkin rc
       LEFT JOIN Reservacion r ON rc.id_reservacion = r.id_reservacion
       LEFT JOIN Pasajero p ON r.id_pasajero = p.id_pasajero
       LEFT JOIN Cabina c ON rc.id_cabina = c.id_cabina
       LEFT JOIN Cabina rcab ON r.id_cabina = rcab.id_cabina
       WHERE rc.id_registro = $1`,
      [idRegistro]
    );

    if (regRes.rows.length === 0) {
      const e = new Error('Check-in not found');
      e.code = 'ERR_NOT_FOUND';
      e.statusCode = 404;
      throw e;
    }

    infoRegistro = regRes.rows[0];
    const idCabina = infoRegistro.id_cabina;

        const totalIterar = listaPiezas ? listaPiezas.length : Math.max(1, cantidadPiezas);
    for (let i = 0; i < totalIterar; i++) {
      const piezaActual = listaPiezas ? listaPiezas[i] : null;
      const etiqueta = `TAG-${idRegistro}-${i + 1}`;
      const tipoTxt = piezaActual?.tipo ? `[${piezaActual.tipo}] ` : '';
      const descripcion = (
        piezaActual?.descripcion
          ? `${tipoTxt}${piezaActual.descripcion}`
          : `Maleta ${i + 1} de ${totalIterar}`
      ).slice(0, 100);

      piezasRegistradas.push({
        etiqueta,
        tipo: piezaActual?.tipo || 'Estándar',
        descripcion,
        estado: 'Registrada',
      });
    }

    const envRes = await client.query(
      `INSERT INTO Envio_equipaje (id_registro, id_cabina, estado, detalle_piezas)
       VALUES ($1, $2, 'Enviado', $3)
       RETURNING id_envio`,
      [idRegistro, idCabina, JSON.stringify(piezasRegistradas)]
    );
    idEnvio = envRes.rows[0].id_envio;



    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Payload oficial Interfaz 10 + tabla de piezas hacia E9 Equipaje (SIN KILOS)
  const luggagePayload = {
    id_registro: idRegistro,
    id_envio: idEnvio,
    id_cliente: infoRegistro.id_cliente_externo || String(infoRegistro.id_pasajero || idRegistro),
    id_cabina: infoRegistro.num_cabina || 'PENDIENTE',
    num_cabina: infoRegistro.num_cabina || 'PENDIENTE',
    noReservacion: infoRegistro.num_reservacion || `RES-${idRegistro}`,
    num_reservacion: infoRegistro.num_reservacion || `RES-${idRegistro}`,
    nombreCompleto: infoRegistro.nombre_completo || 'Pasajero',
    nombre_completo: infoRegistro.nombre_completo || 'Pasajero',
    tipoEquipaje: `${cantidadPiezas} pieza(s) ${isVip ? 'VIP' : 'Estándar'}`,
    estado: infoRegistro.estado || 'En proceso',
    horaRecepcion: new Date().toISOString(),
    cantidad_piezas: cantidadPiezas,
    es_vip: Boolean(isVip),
    piezas: piezasRegistradas,
  };

  const targetLuggageUrl = (process.env.LUGGAGE_URL || LUGGAGE_URL).trim();
  let luggageSync = { sent: false, status: 'SKIPPED_NO_URL' };

  if (targetLuggageUrl) {
    try {
      const extResp = await fetchExternalService(targetLuggageUrl, {
        method: 'POST',
        body: JSON.stringify(luggagePayload),
      });
      luggageSync = { sent: true, status: 'DELIVERED', response: extResp };
    } catch (syncErr) {
      console.warn(`[FALLBACK EQUIPAJE] No se pudo notificar a ${targetLuggageUrl}:`, syncErr.message);
      luggageSync = { sent: false, status: 'UNREACHABLE', error: syncErr.message };
    }
  }

  return {
    message: 'Luggage registered successfully',
    id_envio: idEnvio,
    extraFee,
    luggagePayload,
    luggageSync,
  };
};

// 8. CHECK-OUT (ST08 - ST12) CON TOLERANCIA A FALLOS EN CABINAS Y BANCO
export const processCheckout = async (checkInId, documentNumber, ctaDest, cvv) => {
  const idRegistro = Number(checkInId);

  const result = await pool.query(
    `SELECT COALESCE(rc.id_cabina, r.id_cabina) AS id_cabina, c.num_cabina,
            p.nombre_completo, p.id_cliente_externo, r.ultimos4_tarj
     FROM Registro_checkin rc
     LEFT JOIN Reservacion r ON rc.id_reservacion = r.id_reservacion
     LEFT JOIN Cabina c ON COALESCE(rc.id_cabina, r.id_cabina) = c.id_cabina
     LEFT JOIN Pasajero p ON r.id_pasajero = p.id_pasajero
     WHERE rc.id_registro = $1`,
    [idRegistro]
  );

  if (result.rows.length === 0) {
    const e = new Error('Check-in not found');
    e.code = 'ERR_NOT_FOUND';
    e.statusCode = 404;
    throw e;
  }

    const {
    id_cabina: idCabina,
    num_cabina: numCabina,
    nombre_completo: nombrePasajero,
    id_cliente_externo: idClienteExt,
    ultimos4_tarj: ultimos4Guardados,
  } = result.rows[0];




  const docLimpio = String(
    documentNumber || (ultimos4Guardados ? `453200000000${ultimos4Guardados}` : '4532015112830366')
  ).trim();
  const ultimos4 = docLimpio.slice(-4).padStart(4, '0');
  const cuentaDestino = String(ctaDest || idClienteExt || 'CUENTA-CRUCERO').trim();
  const targetCabinCheckoutUrl = process.env.CABIN_CHECKOUT_URL || CABIN_CHECKOUT_URL;
  const targetBankUrl = process.env.BANK_URL || BANK_URL;

  let cabinReport;
  let cabinOffline = false;

  if (numCabina) {
    try {
      cabinReport = await fetchExternalService(`${targetCabinCheckoutUrl}/${encodeURIComponent(numCabina)}`);
    } catch (err) {
      console.warn(`[FALLBACK CHECKOUT CABINAS] Cabinas no disponible (${err.message}). Inspección marcada pendiente.`);
      cabinOffline = true;
      cabinReport = {
        hasCharges: false,
        amount: 0,
        encargado: 'Contingencia Check-out',
        reason: 'Microservicio Cabinas no disponible al momento del Check-out (Pendiente verificación)',
      };
    }
  } else {
    cabinReport = {
      hasCharges: false,
      amount: 0,
      encargado: 'Sin cabina asignada',
      reason: 'Check-out sin cabina vinculada',
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
        idCabina || null,
        (cabinReport.encargado || 'Inspección Cabinas').slice(0, 100),
        hasCharges,
        (cabinReport.reason || cabinReport.descripcion || 'Sin novedades').slice(0, 250),
        JSON.stringify(cabinReport),
      ]
    );
    const idReportEstado = repRes.rows[0].id_report_estado;

    const ctaRes = await client.query('SELECT id_cuenta FROM cuenta WHERE id_registro = $1 LIMIT 1', [idRegistro]);
    const idCuenta =
      ctaRes.rows[0]?.id_cuenta ||
      (await client.query("INSERT INTO cuenta (id_registro, estado) VALUES ($1, 'Abierta') RETURNING id_cuenta", [idRegistro]))
        .rows[0].id_cuenta;

    if (hasCharges) {
      let bankResult;
      let bankOffline = false;

      try {
        bankResult = await fetchExternalService(targetBankUrl, {
          method: 'POST',
          body: JSON.stringify({
            numTarjeta: docLimpio,
            nomCompleto: nombrePasajero || 'Pasajero Check-out',
            CVV: String(cvv || '123'),
            ctaDest: cuentaDestino,
            Monto: Number(cabinReport.amount),
          }),
        });

        if (bankResult?.success === false || bankResult?.status === 'DECLINED' || bankResult?.edoTr === 'RECHAZADA') {
          const e = new Error(bankResult?.message || 'Extra charges declined');
          e.code = 'ERR_PAYMENT_PENDING';
          e.statusCode = 402;
          throw e;
        }
      } catch (bankErr) {
        if (bankErr.code === 'ERR_PAYMENT_PENDING' || bankErr.isBusinessRejection || bankErr.statusCode === 402) {
          throw bankErr;
        }
        console.warn(
          `[FALLBACK CHECKOUT BANCO] Banco caído (${bankErr.message}). Dejando cobro de $${cabinReport.amount} PENDIENTE.`
        );
        bankOffline = true;
        pendingCharge = true;
        bankResult = { fallback: true, status: 'PENDIENTE_BANCO', edoTr: 'PENDIENTE', reason: bankErr.message };
      }

      const estadoDeposito = bankOffline ? 'Pendiente' : 'Aprobado';
      const edoTrans = bankOffline
        ? 'PENDIENTE'
        : String(bankResult?.edoTr || bankResult?.status || 'APROBADA').slice(0, 40);
      const folio = bankOffline
        ? `PEND-${Date.now()}`.slice(0, 30)
        : String(bankResult?.noTr || bankResult?.transactionId || `FOL-${Date.now()}`).slice(0, 30);
            const parsedFecha = bankResult?.Fecha ? new Date(bankResult.Fecha) : new Date();
      const fechaBanco = Number.isNaN(parsedFecha.getTime()) ? new Date() : parsedFecha;


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
        [cargoRes.rows[0].id_cargo, ultimos4, cabinReport.amount]
      );

      await client.query(
        `INSERT INTO deposito (id_cobro, monto, estado, edo_trans, cta_dest, folio_confirmacion, fecha_respuesta, payload_externo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          cobroRes.rows[0].id_cobro,
          cabinReport.amount,
          estadoDeposito,
          edoTrans,
          cuentaDestino,
          folio,
          fechaBanco,
          JSON.stringify(bankResult),
        ]
      );

      await client.query(
        `INSERT INTO comprobante (id_cuenta, monto_cobrado, folio_deposito) VALUES ($1, $2, $3)`,
        [idCuenta, bankOffline ? 0 : cabinReport.amount, folio]
      );

      chargeMessage = bankOffline
        ? `Check-out registrado con COBRO PENDIENTE de $${cabinReport.amount} (Banco no disponible: ${cabinReport.reason}).`
        : `Check-out successful. Extra charge of $${cabinReport.amount} processed for: ${cabinReport.reason}`;
    }

    const estadoCuentaFinal = pendingCharge ? 'Pendiente' : 'Cerrada';
    await client.query(`UPDATE cuenta SET estado = $1, fecha_cierre = CURRENT_TIMESTAMP WHERE id_cuenta = $2`, [
      estadoCuentaFinal,
      idCuenta,
    ]);

    if (idCabina) {
      await client.query(`UPDATE Cabina SET estado = 'Disponible' WHERE id_cabina = $1`, [idCabina]);
    }

    await client.query(`UPDATE Registro_checkin SET estado = 'Completado' WHERE id_registro = $1`, [idRegistro]);
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
    `SELECT
       rc.id_registro AS id, rc.estado AS status, p.nombre_completo,
       c.num_cabina AS cabin_number, r.num_reservacion AS group_code
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


