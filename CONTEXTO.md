## Estado Actual de Integración (Sin Mocks)
- **Rutas eliminadas:** Se eliminó `src/routes/mock.route.js` y se removió `/api/mock` de `src/app.js` (el respaldo con mocks quedó congelado en `brian-adib/Check-In-Sierra-Madre`).
- **Servicios actualizados (`src/services/checkin.service.js`):** Se reemplazaron las URLs locales por `process.env.RESERVATIONS_URL`, `BANK_URL`, `CABIN_AVAILABILITY_URL` y `CABIN_CHECKOUT_URL` con helper `fetchExternalService` (logs `[OUTBOUND REQUEST]` / `[INBOUND RESPONSE]`).
- **Pendiente:** Revisar `src/config/env.js` y `public/index.html` para limpiar cualquier referencia a `/api/mock`.

## Actualización de Configuración (`src/config/env.js`)
- Se agregaron al esquema de validación Zod en `src/config/env.js` las variables `RESERVATIONS_URL`, `BANK_URL`, `CABIN_AVAILABILITY_URL` y `CABIN_CHECKOUT_URL` con URLs por defecto para evitar que el servidor falle si falta alguna en producción.
- **Siguiente paso:** Revisar el código fuente de `public/index.html` y la carpeta `tests/` para asegurar que ninguna prueba o botón llame a `/api/mock`.


## Actualización de Pruebas Automatizadas (`tests/integration.test.js`)
- Se actualizó `vi.stubGlobal('fetch')` en `tests/integration.test.js` para eliminar referencias a `/api/mock/...` y adaptar el stub al formato `response.text()` de `fetchExternalService`.
- **Estado:** Listo para despliegue en Render y conexión en vivo mediante variables de entorno (`RESERVATIONS_URL`, `BANK_URL`, `CABIN_AVAILABILITY_URL`, `CABIN_CHECKOUT_URL`).

## Corrección de Ruta `/pay` y URL de Pase de Abordar (QR)
- **`src/services/checkin.service.js`:** Se corrigió la URL generada en `generateQR` para apuntar correctamente a `${baseUrl}/api/check-in/boarding-pass/${checkInId}` (usando `process.env.PUBLIC_URL` o `https://onrender.com`).
- **`src/routes/checkin.route.js`:** Se conectó el endpoint `POST /api/check-in/pay` al controlador `pay` existente.

## Soporte para Turso (BD en la Nube) y Actualización de Swagger
- **`src/config/env.js` y `src/db/client.js`:** Se agregó soporte para `DATABASE_AUTH_TOKEN` y `PUBLIC_URL`, permitiendo conectar `@libsql/client` tanto a `file:local.db` en desarrollo como a una base de datos Turso persistente en Render.
- **`docs/swagger.json`:** Actualizado a v1.2.0 sin referencias a mocks y documentando todos los endpoints reales (`/initiate`, `/confirm-reservation`, `/pay`, `/cabins`, `/cabin`, `/luggage`, `/checkout`, `/boarding-pass/{id}`, `/{id}/qr`).

## Limpieza de Seed y Preparación para PostgreSQL (`Dockerfile` y `render.yaml`)
- **`Dockerfile`:** Se eliminó `npm run seed` del comando de arranque (`CMD`) para evitar la carga de datos ficticios (`FAM-001` a `FAM-010`) en producción.
- **`render.yaml`:** Se reemplazó `DATABASE_URL: "file:local.db"` por `sync: false` junto con las URLs de los microservicios externos para gestionar la conexión real a PostgreSQL desde el panel de Render.
- **Siguiente paso:** Revisar `package.json` y migrar la capa de base de datos (`src/db/client.js`, `src/db/migrate.js` y consultas en `checkin.service.js`) de `@libsql/client` (SQLite) a `pg` (PostgreSQL).

## Migración Completa de Lógica a PostgreSQL (`checkin.service.js` y `tests/`)
- **`src/services/checkin.service.js`:** Todas las consultas SQL y transacciones (`BEGIN`, `COMMIT`, `ROLLBACK`) fueron migradas a `pg` (`pool.query` con parámetros `$1, $2...`). Se agregó `ON CONFLICT (id) DO UPDATE` en `assignCabin` para registrar cabinas reales conforme lleguen del microservicio de Cabinas sin depender de datos pre-cargados.
- **`tests/integration.test.js`:** Se añadieron stubs de `pool.query` y `pool.connect` para ejecutar pruebas automatizadas sin requerir una base de datos PostgreSQL levantada.
- **Siguiente paso:** Crear la instancia de PostgreSQL (en Render o Neon) y configurar `DATABASE_URL` en el panel Environment de Render.

