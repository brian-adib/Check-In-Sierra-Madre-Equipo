import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db/client.js';

describe('Flujo E2E de Check-in API (PR11 - PostgreSQL)', () => {
  const mockGroupId = '11111111-1111-1111-1111-111111111111';
  const mockPassengerId = '22222222-2222-2222-2222-222222222222';
  const mockCheckInId = '33333333-3333-3333-3333-333333333333';
  const mockCabinId = '44444444-4444-4444-4444-444444444444';

  beforeAll(() => {
    // 1. Mock de PostgreSQL (pool.query y transacciones)
    vi.spyOn(pool, 'query').mockImplementation((sql, params) => {
      if (sql.includes('FROM check_in_groups')) {
        if (params[0] === 'RSV-REAL-01') return Promise.resolve({ rows: [{ id: mockGroupId }] });
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM passengers')) {
        return Promise.resolve({
          rows: [{ id: mockPassengerId, birth_date: '1990-05-15', first_name: 'Ana', last_name: 'López' }]
        });
      }
      if (sql.includes('SELECT id, cabin_number')) {
        return Promise.resolve({
          rows: [{ id: mockCabinId, cabin_number: 'A-101', deck: 'Deck 1', capacity: 2, occupied: 0 }]
        });
      }
      if (sql.includes('SELECT status, qr_payload FROM check_ins')) {
        return Promise.resolve({ rows: [{ status: 'IN_PROGRESS', qr_payload: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    vi.spyOn(pool, 'connect').mockResolvedValue({
      query: vi.fn((sql) => {
        if (sql.includes('SELECT id FROM check_ins')) {
          return Promise.resolve({ rows: [{ id: mockCheckInId }] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    });

    // 2. Mock de servicios externos
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
          text: () => Promise.resolve(JSON.stringify({ success: true, available: true, cabinNumber: 'A-101', deck: 'Deck 1', capacity: 2 }))
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: true }))
      });
    }));
  });

  it('1. Debe iniciar el check-in de una reserva real existente (ST01)', async () => {
    const res = await request(app)
      .post('/api/check-in/initiate')
      .send({ groupCode: 'RSV-REAL-01' });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkInIds).toContain(mockCheckInId);
  });

  it('2. Debe rechazar una reserva inexistente', async () => {
    const res = await request(app)
      .post('/api/check-in/initiate')
      .send({ groupCode: 'RSV-NO-EXISTE' });

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('ERR_RESERVATION_NOT_FOUND');
  });

  it('3. Debe enviar los datos a Reservaciones para confirmar el Check-in (ST05)', async () => {
    const res = await request(app)
      .post('/api/check-in/confirm-reservation')
      .send({ checkInId: mockCheckInId });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('4. Debe asignar una cabina real correctamente (ST06)', async () => {
    const res = await request(app)
      .post('/api/check-in/cabin')
      .send({ checkInId: mockCheckInId, cabinId: mockCabinId });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('5. Debe generar el código QR en Base64 (SU02)', async () => {
    const res = await request(app).get(`/api/check-in/${mockCheckInId}/qr`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.qrBase64).toContain('data:image/png;base64,');
  });
});
