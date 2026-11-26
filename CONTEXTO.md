## Estado Actual de Integración (Sin Mocks)
- **Rutas eliminadas:** Se eliminó `src/routes/mock.route.js` y se removió `/api/mock` de `src/app.js` (el respaldo con mocks quedó congelado en `brian-adib/Check-In-Sierra-Madre`).
- **Servicios actualizados (`src/services/checkin.service.js`):** Se reemplazaron las URLs locales por `process.env.RESERVATIONS_URL`, `BANK_URL`, `CABIN_AVAILABILITY_URL` y `CABIN_CHECKOUT_URL` con helper `fetchExternalService` (logs `[OUTBOUND REQUEST]` / `[INBOUND RESPONSE]`).
- **Pendiente:** Revisar `src/config/env.js` y `public/index.html` para limpiar cualquier referencia a `/api/mock`.
