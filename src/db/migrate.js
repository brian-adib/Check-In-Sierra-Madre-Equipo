import { pool } from './client.js';

const schemaSQL = `
  -- ================= 10 TABLAS DE CHECK-IN =================

  CREATE TABLE IF NOT EXISTS Pasajero (
    id_pasajero SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(100) NOT NULL,
    fecha_nacimiento DATE NOT NULL,
    telefono VARCHAR(20),
    correo VARCHAR(80),
    nacionalidad VARCHAR(40)
  );

  CREATE TABLE IF NOT EXISTS Cabina (
    id_cabina SERIAL PRIMARY KEY,
    num_cabina VARCHAR(10) UNIQUE NOT NULL,
    estado VARCHAR(12) NOT NULL DEFAULT 'Disponible'
  );

  CREATE TABLE IF NOT EXISTS Reservacion (
    id_reservacion SERIAL PRIMARY KEY,
    num_reservacion VARCHAR(20) UNIQUE NOT NULL,
    id_pasajero INT NOT NULL REFERENCES Pasajero(id_pasajero),
    id_cabina INT NOT NULL REFERENCES Cabina(id_cabina),
    fecha_embarque DATE NOT NULL,
    fecha_desembarque DATE NOT NULL,
    estado VARCHAR(12) NOT NULL DEFAULT 'Vigente'
  );

  CREATE TABLE IF NOT EXISTS Registro_checkin (
    id_registro SERIAL PRIMARY KEY,
    id_reservacion INT NOT NULL REFERENCES Reservacion(id_reservacion),
    id_cabina INT NOT NULL REFERENCES Cabina(id_cabina),
    fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(12) NOT NULL DEFAULT 'En proceso',
    qr_payload TEXT
  );

  CREATE TABLE IF NOT EXISTS solicitud_correcion (
    id_solicitud_corre SERIAL PRIMARY KEY,
    id_registro INT NOT NULL REFERENCES Registro_checkin(id_registro),
    motivo VARCHAR(200) NOT NULL,
    fecha_solicitud TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_corregir TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS decision_excepcion (
    id_decision SERIAL PRIMARY KEY,
    id_solicitud_corre INT NOT NULL REFERENCES solicitud_correcion(id_solicitud_corre),
    decision VARCHAR(10) NOT NULL,
    justificacion VARCHAR(250) NOT NULL,
    fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS Solicitud_cabina (
    id_solicitud_cab SERIAL PRIMARY KEY,
    id_registro INT NOT NULL REFERENCES Registro_checkin(id_registro),
    id_cabina INT NOT NULL REFERENCES Cabina(id_cabina),
    resultado VARCHAR(15) NOT NULL,
    fecha_solicitud TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_respuesta TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS Envio_equipaje (
    id_envio SERIAL PRIMARY KEY,
    id_registro INT NOT NULL REFERENCES Registro_checkin(id_registro),
    id_cabina INT NOT NULL REFERENCES Cabina(id_cabina),
    fecha_envio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(10) NOT NULL DEFAULT 'Enviado'
  );

  -- ================= 6 TABLAS DE CHECK-OUT Y PAGOS =================

  CREATE TABLE IF NOT EXISTS reporte_estado (
    id_report_estado SERIAL PRIMARY KEY,
    id_registro INT NOT NULL REFERENCES Registro_checkin(id_registro),
    id_cabina INT NOT NULL REFERENCES Cabina(id_cabina),
    encargado VARCHAR(100) NOT NULL,
    fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    existen_danos BOOLEAN NOT NULL DEFAULT FALSE,
    descripcion VARCHAR(250)
  );

  CREATE TABLE IF NOT EXISTS cuenta (
    id_cuenta SERIAL PRIMARY KEY,
    id_registro INT NOT NULL REFERENCES Registro_checkin(id_registro),
    estado VARCHAR(10) NOT NULL DEFAULT 'Abierta',
    fecha_apertura TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cargo (
    id_cargo SERIAL PRIMARY KEY,
    id_cuenta INT NOT NULL REFERENCES cuenta(id_cuenta),
    id_report_estado INT REFERENCES reporte_estado(id_report_estado),
    descripcion VARCHAR(250) NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cobro (
    id_cobro SERIAL PRIMARY KEY,
    id_cargo INT NOT NULL REFERENCES cargo(id_cargo),
    forma_pago VARCHAR(15) NOT NULL,
    ultimos4 CHAR(4),
    monto DECIMAL(10,2) NOT NULL,
    fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deposito (
    id_deposito SERIAL PRIMARY KEY,
    id_cobro INT NOT NULL REFERENCES cobro(id_cobro),
    intento INT NOT NULL DEFAULT 1,
    monto DECIMAL(10,2) NOT NULL,
    fecha_envio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(10) NOT NULL DEFAULT 'Enviado',
    folio_confirmacion VARCHAR(30),
    fecha_respuesta TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS comprobante (
    id_comprobante SERIAL PRIMARY KEY,
    id_cuenta INT NOT NULL REFERENCES cuenta(id_cuenta),
    fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    monto_cobrado DECIMAL(10,2) NOT NULL,
    folio_deposito VARCHAR(30) NOT NULL
  );

  -- ================= COLUMNAS TOLERANTES JSONB Y MATRIZ DE CONECTIVIDAD =================
  ALTER TABLE Envio_equipaje ADD COLUMN IF NOT EXISTS detalle_piezas JSONB;
  ALTER TABLE Reservacion ADD COLUMN IF NOT EXISTS payload_externo JSONB;
  ALTER TABLE Cabina ADD COLUMN IF NOT EXISTS payload_externo JSONB;
  ALTER TABLE reporte_estado ADD COLUMN IF NOT EXISTS payload_externo JSONB;
  ALTER TABLE deposito ADD COLUMN IF NOT EXISTS payload_externo JSONB;

  ALTER TABLE Pasajero
    ADD COLUMN IF NOT EXISTS id_cliente_externo VARCHAR(60),
    ADD COLUMN IF NOT EXISTS identificacion VARCHAR(50),
    ADD COLUMN IF NOT EXISTS domicilio VARCHAR(200);

  ALTER TABLE Reservacion
    ADD COLUMN IF NOT EXISTS id_evento_tour VARCHAR(60),
    ADD COLUMN IF NOT EXISTS nombre_viaje VARCHAR(120),
    ADD COLUMN IF NOT EXISTS puerto_salida VARCHAR(80),
    ADD COLUMN IF NOT EXISTS paquete VARCHAR(80),
    ADD COLUMN IF NOT EXISTS num_huespedes INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS total DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS fecha_emision TIMESTAMP,
    ADD COLUMN IF NOT EXISTS ultimos4_tarj VARCHAR(4);

  ALTER TABLE Cabina
    ADD COLUMN IF NOT EXISTS id_cabina_externo VARCHAR(60),
    ADD COLUMN IF NOT EXISTS categoria_tipo VARCHAR(50),
    ADD COLUMN IF NOT EXISTS capacidad INTEGER,
    ADD COLUMN IF NOT EXISTS estatus_operativo VARCHAR(40),
    ADD COLUMN IF NOT EXISTS en_mantenimiento BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS enlazable_reserva BOOLEAN DEFAULT TRUE;

  ALTER TABLE deposito
    ADD COLUMN IF NOT EXISTS edo_trans VARCHAR(40),
    ADD COLUMN IF NOT EXISTS cta_dest VARCHAR(60);

  ALTER TABLE pasajero
  ADD COLUMN IF NOT EXISTS parentesco VARCHAR(30) DEFAULT 'Titular';

ALTER TABLE reservacion
  ADD COLUMN IF NOT EXISTS codigo_grupo VARCHAR(60),
  ADD COLUMN IF NOT EXISTS es_titular BOOLEAN DEFAULT TRUE;

ALTER TABLE cabina
  ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMP;

ALTER TABLE envio_equipaje
  ADD COLUMN IF NOT EXISTS hora_recepcion_ext TIMESTAMP,
  ADD COLUMN IF NOT EXISTS payload_externo JSONB;

ALTER TABLE registro_checkin
  ADD COLUMN IF NOT EXISTS hora_recepcion_ext TIMESTAMP,
  ADD COLUMN IF NOT EXISTS estado_embarque VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payload_externo JSONB;

ALTER TABLE deposito
  ADD COLUMN IF NOT EXISTS monto_aprobado_banco DECIMAL(10,2);

`;

async function runMigrations() {
  console.log('🔄 Verificando/actualizando las 16 tablas oficiales PR11 con soporte JSONB y Matriz...');
  try {
    await pool.query(schemaSQL);
    console.log('✅ Esquema PR11 listo en PostgreSQL.');
  } catch (error) {
    console.error('❌ Error ejecutando migraciones en PostgreSQL:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
