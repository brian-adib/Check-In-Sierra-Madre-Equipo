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

## Adaptador Tolerante (ACL) y Conexión Completa a las 16 Tablas Oficiales
- **Esquema PostgreSQL (`src/db/migrate.js`):** Se agregaron columnas `payload_externo JSONB` en `Reservacion`, `Cabina`, `reporte_estado` y `deposito` para conservar el JSON crudo recibido de otros equipos sin perder compatibilidad con las 16 tablas del modelo relacional.
- **Endpoint Receptor (`POST /api/check-in/reservations`):** Implementado con Lector Tolerante (Zod `.passthrough()`) capaz de recibir pasajeros individuales o familias completas (`pasajeros` / `passengers`) con variantes de campos en español o inglés y registrarlos automáticamente en `Cabina`, `Pasajero` y `Reservacion`.
- **Servicios y Pruebas (`checkin.service.js`, `tests/integration.test.js`):** Todo el flujo de Check-in, Equipaje, Pagos, QR y Check-out opera ahora directamente sobre las 16 tablas oficiales (`Registro_checkin`, `Solicitud_cabina`, `Envio_equipaje`, `Pieza_equipaje`, `reporte_estado`, `cuenta`, `cargo`, `cobro`, `deposito`, `comprobante`).


## Documentación Swagger Actualizada (`docs/swagger.json` v1.3.0)
- Se documentó el endpoint receptor `POST /api/check-in/reservations` con esquema de ejemplo para familias completas (`pasajeros`) y campos tolerantes.
- Se actualizaron los tipos y ejemplos de `checkInId` a enteros (`SERIAL`) en `/confirm-reservation`, `/pay`, `/cabin`, `/luggage`, `/checkout`, `/boarding-pass/{id}` y `/{id}/qr`.

## Base de Datos en la Nube (Neon) y Despliegue en Vivo (Render)
- **Base de Datos PostgreSQL en Neon (`cruceroE11-db`):** Conectada mediante `DATABASE_URL` en el panel **Environment** de Render. Al iniciar el contenedor, `npm run migrate` creó exitosamente las **16 tablas oficiales PR11** con soporte de columnas tolerantes `payload_externo JSONB`.
- **Despliegue en Render:** Servicio activo y en línea en `https://onrender.com` (`Deploy succeeded | Live`).
- **Documentación Swagger (`docs/swagger.json` v1.3.0):** Actualizado con el endpoint receptor `POST /api/check-in/reservations` (Adaptador Tolerante ACL), ejemplos con IDs enteros reales y configurado con `https://onrender.com` como servidor principal por defecto.
- **Pruebas Automatizadas:** Suite completa de `8/8` tests pasando en verde (`tests/health.test.js` y `tests/integration.test.js`).

# Contexto del Proyecto: Microservicio Check-in / Check-out (Equipo 11)

## Descripción General
Microservicio de **Recepción (Check-in y Check-out)** para el ecosistema del crucero **Sierra Madre Resort & Casino** (`PR11`).
- **Repositorio Activo (Integración Real):** `https://github.com`
- **Repositorio de Respaldo (Congelado con Mocks):** `https://github.com`
- **URL de Producción (Render):** `https://onrender.com` (`Deploy succeeded | Live`)
- **Documentación Swagger:** `https://onrender.com/docs` (`docs/swagger.json` v1.3.0)
- **Health Check:** `https://onrender.com/health`

---

## Arquitectura y Stack Tecnológico
- **Runtime & Framework:** Node.js 20 (ESM) + Express (`src/app.js`, `src/index.js`).
- **Arquitectura en Capas + Anti-Corruption Layer (ACL):**
  - `src/routes/checkin.route.js`: Endpoints REST bajo `/api/check-in`.
  - `src/controllers/checkin.controller.js`: Manejo HTTP y respuestas estandarizadas.
  - `src/validators/checkin.validator.js`: Validación tolerante con **Zod** (`.passthrough()` para aceptar campos adicionales de otros microservicios sin rechazar peticiones).
  - `src/services/checkin.service.js`: Lógica de negocio, transacciones SQL y cliente HTTP saliente (`fetchExternalService` con trazabilidad `[OUTBOUND REQUEST]` / `[INBOUND RESPONSE]`).
  - `src/db/`: Cliente PostgreSQL (`client.js` usando `pg.Pool` con SSL) y script de creación de tablas (`migrate.js`).
  - `public/index.html`: Interfaz web de Recepción y Gerente conectada directamente a los endpoints reales (sin datos ficticios ni *mocks*).
- **Contenerización y CI/CD:**
  - `Dockerfile`: Imagen multi-etapa `node:20-slim`. Ejecuta `npm run migrate && npm start` al arrancar (sin `seed`).
  - `render.yaml`: Configuración de despliegue en Render (`sync: false` para secretos y URLs externas).
  - `.github/workflows/ci.yml`: Ejecuta `npm run lint` y `npm run test` (Vitest + Supertest, `8/8` pruebas pasando en verde).

---

## Base de Datos Oficial (PostgreSQL en Neon - 16 Tablas PR11)
Alojada en **Neon** (`cruceroE11-db`, región Oregon) y conectada vía `DATABASE_URL` en Render. Implementada según el Modelo Relacional y Diccionario de Datos oficial del Equipo 11:
- **Check-in (10 tablas):** `Pasajero`, `Cabina`, `Reservacion`, `Registro_checkin`, `solicitud_correcion`, `decision_excepcion`, `Solicitud_cabina`, `Envio_equipaje`, `Pieza_equipaje`, `reporte_error_equipaje`.
- **Check-out y Pagos (6 tablas):** `reporte_estado`, `cuenta`, `cargo`, `cobro`, `deposito`, `comprobante`.
- **Soporte ACL (`JSONB`):** Las tablas `Reservacion`, `Cabina`, `reporte_estado` y `deposito` incluyen la columna `payload_externo JSONB` para conservar intactos los JSON enviados por otros equipos.
- **Estado de Datos:** Verificada en vivo mediante Swagger (`POST /api/check-in/reservations` -> `201 Created`) y posteriormente limpiada mediante `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` (las 16 tablas están en cero e IDs reiniciados a `1`, listas para recibir datos reales en clase).

---

## Variables de Entorno (`src/config/env.js`)
- `PORT`: Puerto del servidor (`3000`).
- `NODE_ENV`: `development` | `production` | `test`.
- `DATABASE_URL`: Cadena de conexión a PostgreSQL en Neon.
- `PUBLIC_URL`: `https://onrender.com` (usada para generar la URL del QR).
- `RESERVATIONS_URL`: Endpoint `POST` del microservicio de Reservaciones.
- `BANK_URL`: Endpoint `POST` del microservicio de Banco.
- `CABIN_AVAILABILITY_URL`: Endpoint `GET` base de disponibilidad de Cabinas (`/:cabinId`).
- `CABIN_CHECKOUT_URL`: Endpoint `GET` base de reporte de daños/cargos de Cabinas (`/:cabinId`).

---

## Endpoints Expuestos (`/api/check-in`)
- `POST /api/check-in/reservations` — **Receptor ACL:** Recibe pasajeros individuales o familias completas desde Reservaciones y los guarda en `Cabina`, `Pasajero` y `Reservacion`.
- `POST /api/check-in/initiate` — Inicia check-in validando reserva y regla de mayoría de edad (`ST01`).
- `POST /api/check-in/confirm-reservation` — Envía solicitud de confirmación a Reservaciones (`ST05`).
- `POST /api/check-in/pay` — Envía cargo al microservicio de Banco y registra en `cargo`, `cobro`, `deposito` y `comprobante` (`ST04`).
- `GET /api/check-in/cabins` — Lista cabinas registradas localmente.
- `POST /api/check-in/cabin` — Consulta disponibilidad a Cabinas, registra en `Solicitud_cabina` y asigna (`ST06`).
- `POST /api/check-in/luggage` — Registra maletas en `Envio_equipaje` y `Pieza_equipaje` (`ST07`).
- `POST /api/check-in/checkout` — Consulta reporte de daños a Cabinas (`reporte_estado`), cobra cargos extra con Banco y cierra `cuenta` (`ST08`-`ST12`).
- `GET /api/check-in/boarding-pass/:id` — Renderiza vista HTML del pase de abordar.
- `GET /api/check-in/:id/qr` — Genera código QR en Base64 (`SU02`).

---

## Pendientes para Próxima Sesión
1. Agregar variable `BOARDING_URL` e integrar envío saliente hacia el microservicio de **Embarque (`CHK-EMB`)** con la interfaz `DATOS_PASAJERO` al completar el check-in / generar QR.
2. Configurar en **Render -> Environment** las URLs reales (`RESERVATIONS_URL`, `BANK_URL`, `CABIN_AVAILABILITY_URL`, `CABIN_CHECKOUT_URL`, `BOARDING_URL`) en cuanto los demás equipos compartan sus enlaces.

## Listado de Reservaciones y Conexión Saliente a Embarque (`CHK-EMB`)
- **Variables de Entorno (`src/config/env.js`, `.env.example`, `render.yaml`):** Se agregó `BOARDING_URL` para apuntar al microservicio de Embarque.
- **Nuevo Endpoint (`GET /api/check-in/reservations`):** Devuelve las reservaciones y pasajeros registrados en PostgreSQL (`Reservacion`, `Pasajero`, `Cabina`, `Registro_checkin`) para poblar dinámicamente el Dashboard del frontend.
- **Integración Embarque (`generateQR` en `checkin.service.js`):** Al generar el código QR (`SU02`), el backend consulta los datos completos del pasajero y su equipaje y envía el payload `DATOS_PASAJERO` (`noCabina`, `horaRecepcion`, `noReservacion`, `nombreCompleto`, `tipoEquipaje`, `estado`) hacia `BOARDING_URL` de forma tolerante (no bloquea la entrega del QR si Embarque aún no está en línea).
- **Pruebas (`tests/integration.test.js`):** Ampliadas a `9/9` pruebas pasando en verde cubriendo `GET /reservations` y el envío saliente hacia Embarque.

## Listado de Reservaciones (`GET /reservations`) y Envío a Embarque (`CHK-EMB`)
- **`src/config/env.js`, `.env.example`, `render.yaml`:** Agregada variable `BOARDING_URL` para conectar con el microservicio de Embarque.
- **Nuevo Endpoint (`GET /api/check-in/reservations`):** Consulta `Reservacion`, `Pasajero`, `Cabina` y `Registro_checkin` para mostrar en el Dashboard las reservaciones reales recibidas.
- **Envío a Embarque (`generateQR` en `checkin.service.js`):** Al generar el pase QR (`SU02`), envía `DATOS_PASAJERO` (`noCabina`, `horaRecepcion`, `noReservacion`, `nombreCompleto`, `tipoEquipaje`, `estado`) hacia `BOARDING_URL` de forma tolerante.


### Actualización de Servicios, Integración con Embarque y Pruebas (Paso 1 Completado)
- **`src/services/checkin.service.js`:**
  - Implementado `getAllReservations()` consultando `Reservacion`, `Pasajero`, `Cabina` y `Registro_checkin` en Neon para alimentar `GET /api/check-in/reservations`.
  - Actualizado `generateQR(checkInId)` con envío saliente HTTP `POST` tolerante a fallos (`try/catch`) hacia `BOARDING_URL` con el contrato oficial `DATOS_PASAJERO` (`evento`, `noCabina`, `horaRecepcion`, `noReservacion`, `nombreCompleto`, `tipoEquipaje`, `estado`).
- **`tests/integration.test.js`:**
  - Suite actualizada en Vitest (9 tests totales en verde junto con `health.test.js`), validando `GET /api/check-in/reservations` y la notificación saliente hacia `BOARDING_URL`.

  ### Actualización de Dashboard Web y Documentación OpenAPI (Pasos 2 y 3 Completados)
- **`public/index.html`:**
  - Conectado el Dashboard de Recepción a `GET /api/check-in/reservations` para listar en tiempo real las reservaciones almacenadas en PostgreSQL (Neon) con botón de inicio/continuación rápida de Check-in en un clic.
  - Garantizado que `currentCheckInId` almacene siempre un entero `SERIAL` limpio (`Number(ids[0])`) para los endpoints `/confirm-reservation`, `/cabin`, `/luggage`, `/{id}/qr` y `/checkout`.
  - Agregada traza de sincronización con Embarque (`CHK-EMB`) en el panel flotante de tráfico de microservicios al generar el QR.
- **`docs/swagger.json`:**
  - Documentado el endpoint `GET /api/check-in/reservations` y la notificación saliente `DATOS_PASAJERO` hacia `BOARDING_URL` en `GET /api/check-in/{id}/qr`.

  ### Tolerancia a Fallos / Patrón Fallback en Microservicios Externos
- **`src/services/checkin.service.js`:**
  - Implementado manejo de contingencia (*Fallback*) cuando los servicios vecinos (`RESERVATIONS_URL`, `CABIN_AVAILABILITY_URL`, `CABIN_CHECKOUT_URL`, `BANK_URL`) están caídos o inaccesibles, diferenciando fallos de red (`fetch failed`) de rechazos reales de negocio (`400`, `402`, `409`).
  - Cuando **Banco** no responde, el pago se registra en `deposito` con estado `Pendiente` (y `cuenta` como `Pendiente de cobro` en Check-out), notificando el adeudo pendiente sin interrumpir la operación.
  - Cuando **Reservaciones** o **Cabinas** no responden, se aprueba localmente en modo contingencia (`PENDING_SYNC` / `Asignada (Pendiente Sync)`).
- **`tests/integration.test.js`:**
  - Agregada prueba de tolerancia a fallos verificando el registro de pago `Pendiente` ante caída del microservicio de Banco (10 tests totales en verde).

### Validación Tolerante de Variables de Entorno en Despliegue
- **`src/config/env.js`:**
  - Implementado helper `optionalServiceUrl(defaultUrl)` en el esquema de Zod para limpiar espacios (`trim()`) y aplicar respaldo automático si alguna variable de microservicio externo en Render (`RESERVATIONS_URL`, `BANK_URL`, `CABIN_AVAILABILITY_URL`, `CABIN_CHECKOUT_URL`, `BOARDING_URL`) se deja vacía o con texto placeholder mientras los demás equipos publican sus URLs.

### Ajuste de Longitud VARCHAR(15) en Fallback de Cabinas y Cuenta
- **`src/services/checkin.service.js`:**
  - Ajustados los textos de estado de contingencia en `Solicitud_cabina.resultado` (`'Pendiente Sync'`, 14 caracteres) y `cuenta.estado` (`'Pendiente'`, 9 caracteres) para respetar la restricción `VARCHAR(15)` del esquema PR11 en PostgreSQL (Neon).
  
  ### Corrección de URL Pública en Generación de Código QR
- **`src/services/checkin.service.js`:**
  - Corregido el dominio base en `generateQR(checkInId)` hacia `sierra-madre-checkin.onrender.com/api/check-in/boarding-pass/{id}` y habilitada la regeneración/actualización automática de `qr_payload` en PostgreSQL (Neon) al solicitar el pase de abordar.

  ### Exportación de Formato Oficial FR011 y Limpieza de Codificación UTF-8
- **`public/index.html`:**
  - Conectado `generarFR011()` con los datos reales cargados desde PostgreSQL (Neon) (`nombre_completo`, `num_cabina`, `nacionalidad`, `piezas` y `peso`) y agregado botón de exportación tanto en el Paso 1, Paso 4 como en el panel lateral de resumen del asistente.
  - Restaurada codificación UTF-8 limpia en toda la interfaz web.

  ### Exportación de Formato FR011, Limpieza de Servicio y Suite de 10 Pruebas en Verde
- **`src/services/checkin.service.js`:**
  - Restaurado `sendToReservations(checkInId)`, eliminada declaración duplicada de `processCheckout` y corregido acceso a filas (`rows`) en consultas PostgreSQL.
  - Mantenido contrato de payload hacia Banco (`numTarjeta`, `nomCompleto`, `CVV`, `ctaDest`, `Monto`) y `COALESCE` de cabina en `generateQR`.
- **`public/index.html`:**
  - Conectado `generarFR011()` con los datos reales de la reservación desde Neon (`nombre_completo`, `num_cabina`, `nacionalidad`, `equipaje`) y restaurada codificación UTF-8 limpia.
- **`tests/integration.test.js`:**
  - Ajustado mock de consulta `generateQR` en Vitest; suite completa de 10 tests pasando en verde.

### Corrección de Llave Primaria en Subconsulta de Cabina (`generateQR`)
- **`src/services/checkin.service.js`:** Corregida referencia de columna de ordenamiento en `generateQR(checkInId)` de `sc.id_solicitud` a `sc.id_solicitud_cab` conforme al esquema oficial de `Solicitud_cabina` en `src/db/migrate.js`.

### Endpoint Índice Informativo en API
- **`src/routes/checkin.route.js`:**
  - Agregada ruta raíz `GET /api/check-in` que retorna un índice JSON descriptivo con todos los endpoints disponibles del microservicio, métodos HTTP y rutas a `/docs` y `/health`.

### Contrato Completo de Salida hacia Microservicio de Equipaje (Sin Kilos)
- **`src/config/env.js`, `.env.example`, `render.yaml`:**
  - Agregada variable opcional `LUGGAGE_URL` con tolerancia a fallos.
- **`src/services/checkin.service.js`:**
  - Actualizado `registerLuggage(data)` para construir y enviar `luggagePayload` con `id_registro`, `num_reservacion`, `nombre_completo`, `num_cabina`, `cantidad_piezas`, `es_vip` y `piezas` (sin incluir datos de peso/kilos), registrando estado `SKIPPED_NO_URL` o `UNREACHABLE` si el servicio externo aún no está publicado.
