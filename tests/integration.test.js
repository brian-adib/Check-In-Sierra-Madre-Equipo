import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db/client.js';

describe('Flujo E2E de Check-in API (PR11 - 16 Tablas Oficiales + Fallback)', () => {
  beforeAll(() => {
    process.env.BOARDING_URL = 'http://localhost:3004/api/boarding/passengers';

    vi.spyOn(pool, 'query').mockImplementation((sql, params) => {
      if (sql.includes('ORDER BY r.id_reservacion DESC')) {
        return Promise.resolve({
          rows: [
            {
              id_reservacion: 10,
              num_reservacion: 'RSV-FAM-01',
              estado_reservacion: 'Vigente',
              id_pasajero: 20,
              nombre_completo: 'Carlos Ruiz',
              num_cabina: 'C-104',
              id_checkin: 101,
              estado_checkin: 'En proceso'
            }
          ]
        });
      }
      if (sql.includes('FROM Reservacion r') && !sql.includes('SELECT rc.estado')) {
        if (Array.isArray(params) && params.includes('RSV-FAM-01')) {
          return Promise.resolve({
            rows: [{ id_reservacion: 10, num_reservacion: 'RSV-FAM-01', id_cabina: 5, nombre_completo: 'Carlos Ruiz', fecha_nacimiento: '1988-04-12' }]
          });
        }
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM Registro_checkin rc') && sql.includes('LEFT JOIN Cabina c')) {
        return Promise.resolve({
          rows: [{
            estado: 'En proceso',
            qr_payload: null,
            num_reservacion: 'RSV-FAM-01',
            nombre_completo: 'Carlos Ruiz',
            num_cabina: 'C-104',
            tipo_equipaje: 'Maleta 1 (18 kg total)'
          }]
        });
      }
      if (sql.includes('FROM Registro_checkin rc')) {
        return Promise.resolve({ rows: [{ id_registro: 101, num_reservacion: 'RSV-FAM-01', nombre_completo: 'Carlos Ruiz' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    vi.spyOn(pool, 'connect').mockResolvedValue({
      query: vi.fn((sql) => {
        if (sql.includes('INSERT INTO Cabina')) return Promise.resolve({ rows: [{ id_cabina: 5 }] });
        if (sql.includes('INSERT INTO Pasajero')) return Promise.resolve({ rows: [{ id_pasajero: 20 }] });
        if (sql.includes('INSERT INTO Reservacion')) return Promise.resolve({ rows: [{ id_reservacion: 10, num_reservacion: 'RSV-FAM-01' }] });
        if (sql.includes('SELECT id_registro FROM Registro_checkin')) return Promise.resolve({ rows: [{ id_registro: 101 }] });
        if (sql.includes('INSERT INTO Solicitud_cabina')) return Promise.resolve({ rows: [{ id_solicitud_cab: 1 }] });
        if (sql.includes('SELECT id_cuenta')) return Promise.resolve({ rows: [{ id_cuenta: 30 }] });
        if (sql.includes('INSERT INTO cargo')) return Promise.resolve({ rows: [{ id_cargo: 40 }] });
        if (sql.includes('INSERT INTO cobro')) return Promise.resolve({ rows: [{ id_cobro: 50 }] });
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    });

    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/reservations/confirm')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ success: true, message: 'Check-in confirmado por Reservaciones' }))
        });
      }
      if (url.includes('/cabins/availability/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ success: true, available: true }))
        });
      }
      if (url.includes('/bank/charge')) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      if (url.includes('/boarding/passengers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ success: true, message: 'Pasajero recibido en Embarque' }))
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: true }))
      });
    }));
  });

  it('1. Debe recibir y guardar una reservación real mediante el Adaptador Tolerante', async () => {
    const res = await request(app)
      .post('/api/check-in/reservations')
      .send({
        clave_reserva: 'RSV-FAM-01',
        cabina: 'C-104',
        pasajeros: [{ nombre: 'Carlos Ruiz', fecha_nacimiento: '1988-04-12' }]
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.codigoBase).toBe('RSV-FAM-01');
  });

  it('2. Debe listar las reservaciones registradas en Neon (GET /api/check-in/reservations)', async () => {
    const res = await request(app).get('/api/check-in/reservations');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].num_reservacion).toBe('RSV-FAM-01');
  });

  it('3. Debe iniciar el check-in de una reserva real existente (ST01)', async () => {
    const res = await request(app)
      .post('/api/check-in/initiate')
      .send({ groupCode: 'RSV-FAM-01' });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkInIds).toContain(101);
  });

  it('4. Debe rechazar una reserva inexistente', async () => {
    const res = await request(app)
      .post('/api/check-in/initiate')
      .send({ groupCode: 'RSV-NO-EXISTE' });

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('ERR_RESERVATION_NOT_FOUND');
  });

  it('5. Debe enviar los datos a Reservaciones para confirmar el Check-in (ST05)', async () => {
    const res = await request(app)
      .post('/api/check-in/confirm-reservation')
      .send({ checkInId: 101 });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('6. Debe asignar una cabina real correctamente (ST06)', async () => {
    const res = await request(app)
      .post('/api/check-in/cabin')
      .send({ checkInId: 101, cabinId: 'C-104' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('7. Debe generar el código QR en Base64 y enviar DATOS_PASAJERO a Embarque (SU02 / CHK-EMB)', async () => {
    const res = await request(app).get('/api/check-in/101/qr');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.qrBase64).toContain('data:image/png;base64,');
    expect(res.body.data.datosPasajero).toMatchObject({
      evento: 'DATOS_PASAJERO',
      noCabina: 'C-104',
      noReservacion: 'RSV-FAM-01',
      nombreCompleto: 'Carlos Ruiz',
      estado: 'En proceso'
    });
    expect(res.body.data.boardingSync.sent).toBe(true);
  });

  it('8. Debe aplicar tolerancia a fallos (Fallback) y registrar cobro PENDIENTE si Banco está caído', async () => {
    const res = await request(app)
      .post('/api/check-in/pay')
      .send({ checkInId: 101, amount: 250, documentNumber: '4532015112830366' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.paymentStatus).toBe('Pendiente');
    expect(res.body.data.fallbackMode).toBe(true);
    expect(res.body.data.message).toContain('PENDIENTE');
  });
});


