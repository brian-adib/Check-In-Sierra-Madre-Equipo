import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db/client.js';

describe('Flujo E2E de Check-in API (PR11 - 16 Tablas Oficiales)', () => {
  beforeAll(() => {
    vi.spyOn(pool, 'query').mockImplementation((sql, params) => {
      if (sql.includes('FROM Reservacion r')) {
        if (Array.isArray(params) && params.includes('RSV-FAM-01')) {
          return Promise.resolve({
            rows: [{ id_reservacion: 10, num_reservacion: 'RSV-FAM-01', id_cabina: 5, nombre_completo: 'Carlos Ruiz', fecha_nacimiento: '1988-04-12' }]
          });
        }
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM Registro_checkin rc')) {
        return Promise.resolve({ rows: [{ id_registro: 101, num_reservacion: 'RSV-FAM-01', nombre_completo: 'Carlos Ruiz' }] });
      }
      if (sql.includes('SELECT estado, qr_payload FROM Registro_checkin')) {
        return Promise.resolve({ rows: [{ estado: 'En proceso', qr_payload: null }] });
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

  it('2. Debe iniciar el check-in de una reserva real existente (ST01)', async () => {
    const res = await request(app)
      .post('/api/check-in/initiate')
      .send({ groupCode: 'RSV-FAM-01' });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkInIds).toContain(101);
  });

  it('3. Debe rechazar una reserva inexistente', async () => {
    const res = await request(app)
      .post('/api/check-in/initiate')
      .send({ groupCode: 'RSV-NO-EXISTE' });

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('ERR_RESERVATION_NOT_FOUND');
  });

  it('4. Debe enviar los datos a Reservaciones para confirmar el Check-in (ST05)', async () => {
    const res = await request(app)
      .post('/api/check-in/confirm-reservation')
      .send({ checkInId: 101 });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('5. Debe asignar una cabina real correctamente (ST06)', async () => {
    const res = await request(app)
      .post('/api/check-in/cabin')
      .send({ checkInId: 101, cabinId: 'C-104' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('6. Debe generar el código QR en Base64 (SU02)', async () => {
    const res = await request(app).get('/api/check-in/101/qr');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.qrBase64).toContain('data:image/png;base64,');
  });
});

