# Contexto del Proyecto: Microservicio Check-in / Check-out (Equipo 11)

## Descripción General
Microservicio de **Recepción (Check-in y Check-out)** para el ecosistema del crucero **Sierra Madre Resort & Casino** (`PR11`).
- **Repositorio Activo (Integración Real):** `https://github.com`
- **Repositorio de Respaldo (Congelado con Mocks):** `https://github.com`
- **URL de Producción (Render):** `https://onrender.com`
- **Documentación Swagger:** `/docs` (`docs/swagger.json` v1.2.0)
- **Health Check:** `/health`

---

## Arquitectura y Stack Tecnológico
- **Runtime & Framework:** Node.js 20 (ESM) + Express (`src/app.js`, `src/index.js`).
- **Arquitectura en Capas:**
  - `src/routes/`: Definición de endpoints REST (`/health`, `/api/check-in/*`).
  - `src/controllers/`: Manejo de peticiones HTTP, respuestas estandarizadas y validación de entrada con **Zod** (`src/validators/`).
  - `src/services/checkin.service.js`: Lógica de negocio, transacciones SQL y cliente HTTP saliente (`fetchExternalService` con trazabilidad `[OUTBOUND REQUEST]` / `[INBOUND RESPONSE]`).
  - `src/db/`: Cliente PostgreSQL (`client.js` usando `pg.Pool`) y script de creación de tablas (`migrate.js`).
  - `public/index.html`: Interfaz web de Recepción y Gerente conectada directamente a los endpoints reales (sin datos ficticios ni *mocks*).
- **Contenerización y CI/CD:**
  - `Dockerfile`: Imagen multi-etapa `node:20-slim`. Ejecuta `npm run migrate && npm start` al arrancar (sin `seed`).
  - `render.yaml`: Configuración de despliegue en Render (`sync: false` para secretos y URLs externas).
  - `.github/workflows/ci.yml`: Ejecuta `npm run lint` y `npm run test` (Vitest + Supertest) en cada `push` o `pull_request`.

---

## Base de Datos (PostgreSQL)
Migrado completamente de SQLite (`@libsql/client`) a **PostgreSQL (`pg`)**. Se eliminó `src/db/seed.js` para operar únicamente con datos reales.
- **Tablas definidas en `src/db/migrate.js`:**
  1. `check_in_groups` (`id`, `group_code`, `status`, `created_at`)
  2. `passengers` (`id`, `group_id`, `first_name`, `last_name`, `document_number`, `birth_date`, `is_vip`)
  3. `cabins` (`id`, `cabin_number`, `deck`, `capacity`, `occupied`) — se sincroniza dinámicamente mediante `ON CONFLICT (id) DO UPDATE` al consultar disponibilidad real.
  4. `check_ins` (`id`, `passenger_id`, `cabin_id`, `status`, `qr_payload`, `updated_at`)
  5. `payments` (`id`, `check_in_id`, `external_transaction_id`, `amount_cents`, `concept`, `status`, `created_at`)
  6. `luggage` (`id`, `check_in_id`, `bag_count`, `total_weight_kg`, `extra_fee_cents`, `created_at`)

---

## Variables de Entorno (`src/config/env.js`)
Validadas al arrancar mediante Zod:
- `PORT`: Puerto del servidor (default `3000`).
- `NODE_ENV`: `development` | `production` | `test`.
- `DATABASE_URL`: Cadena de conexión a PostgreSQL (`postgresql://...`).
- `PUBLIC_URL`: URL pública del servicio para generar el enlace del QR (`https://onrender.com`).
- `RESERVATIONS_URL`: Endpoint `POST` del microservicio de Reservaciones.
- `BANK_URL`: Endpoint `POST` del microservicio de Banco.
- `CABIN_AVAILABILITY_URL`: Endpoint `GET` base de disponibilidad de Cabinas (`/:cabinId`).
- `CABIN_CHECKOUT_URL`: Endpoint `GET` base de reporte de daños/cargos de Cabinas (`/:cabinId`).

---

## Endpoints Expuestos (`/api/check-in`)
- `POST /api/check-in/initiate` — Inicia check-in validando grupo y regla de mayoría de edad (`ST01`).
- `POST /api/check-in/confirm-reservation` — Envía solicitud de confirmación a Reservaciones (`ST05`).
- `POST /api/check-in/pay` — Envía cargo al microservicio de Banco y registra pago (`ST04`).
- `GET /api/check-in/cabins` — Lista cabinas registradas localmente.
- `POST /api/check-in/cabin` — Consulta disponibilidad al microservicio de Cabinas y asigna (`ST06`).
- `POST /api/check-in/luggage` — Registra maletas y valida límites de peso/piezas (`ST07`).
- `POST /api/check-in/checkout` — Consulta reporte de daños a Cabinas y liquida cargos extra con Banco (`ST08`-`ST12`).
- `GET /api/check-in/boarding-pass/:id` — Renderiza vista HTML del pase de abordar.
- `GET /api/check-in/:id/qr` — Genera código QR en Base64 (`SU02`).

---

## Estado Actual y Próximos Pasos
- **Completado:** Eliminación total de `/api/mock` y `seed.js`; migración a `pg`; limpieza de `public/index.html`; pipeline de CI/CD en verde (`7/7` tests pasando).
- **Pendiente:**
  1. Crear la instancia de PostgreSQL en Render y configurar `DATABASE_URL` en el panel **Environment** del servicio web.
  2. Crear endpoint receptor (ej. `POST /api/check-in/reservations`) para registrar en `check_in_groups` y `passengers` las reservaciones reales enviadas por el equipo de Reservaciones.
  3. Integrar envío saliente hacia el microservicio de **Embarque** (`DATOS_PASAJERO`) al finalizar el check-in.

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

## Actualización de CI/CD en GitHub Actions (`.github/workflows/ci.yml`)
- Se eliminaron los pasos `npm run migrate` y `npm run seed` del pipeline de CI (ya que las migraciones reales corren al arrancar el contenedor en Render contra PostgreSQL).
- Se actualizó `DATABASE_URL` en el `.env` temporal del CI al formato `postgresql://...` para cumplir con la validación de Zod en `env.js`.

## Limpieza de Frontend (`public/index.html`)
- Se eliminaron las reservaciones ficticias (`FAM-001` a `FAM-010`) y las cabinas simuladas en `catch()`.
- Se conectó el dashboard al flujo real de Check-in (`POST /api/check-in/initiate`, `/confirm-reservation`, `/cabin`, `/luggage`, `/{id}/qr`) y al endpoint real de Check-out (`POST /api/check-in/checkout`).

## Base de Datos Oficial (PostgreSQL en Neon - 16 Tablas PR11)
Implementado exactamente según el Modelo Relacional y Diccionario de Datos oficial del Equipo 11:
- **Check-in (10 tablas):** `Pasajero`, `Cabina`, `Reservacion`, `Registro_checkin`, `solicitud_correcion`, `decision_excepcion`, `Solicitud_cabina`, `Envio_equipaje`, `Pieza_equipaje`, `reporte_error_equipaje`.
- **Check-out y Pagos (6 tablas):** `reporte_estado`, `cuenta`, `cargo`, `cobro`, `deposito`, `comprobante`.
- **Pendiente inmediato:** Adaptar `src/services/checkin.service.js`, `src/validators/checkin.validator.js` y `tests/integration.test.js` para consultar e insertar directamente sobre estas 16 tablas oficiales.
