import { pool } from './client.js';

const schemaSQL = `
  -- Limpiar tablas anteriores si existen
  DROP TABLE IF EXISTS luggage CASCADE;
  DROP TABLE IF EXISTS payments CASCADE;
  DROP TABLE IF EXISTS check_ins CASCADE;
  DROP TABLE IF EXISTS cabins CASCADE;
  DROP TABLE IF EXISTS passengers CASCADE;
  DROP TABLE IF EXISTS check_in_groups CASCADE;

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

  CREATE TABLE IF NOT EXISTS Pieza_equipaje (
    id_pieza SERIAL PRIMARY KEY,
    id_envio INT NOT NULL REFERENCES Envio_equipaje(id_envio),
    etiqueta VARCHAR(20) NOT NULL,
    descripcion VARCHAR(100) NOT NULL,
    estado VARCHAR(10) NOT NULL DEFAULT 'Registrada'
  );

  CREATE TABLE IF NOT EXISTS reporte_error_equipaje (
    id_report_error SERIAL PRIMARY KEY,
    id_envio INT NOT NULL REFERENCES Envio_equipaje(id_envio),
    id_pieza INT REFERENCES Pieza_equipaje(id_pieza),
    descripcion VARCHAR(250) NOT NULL,
    fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
`;

async function runMigrations() {
  console.log('🔄 Creando las 16 tablas oficiales del modelo relacional PR11 en PostgreSQL...');
  try {
    await pool.query(schemaSQL);
    console.log('✅ Las 16 tablas oficiales fueron creadas correctamente en PostgreSQL.');
  } catch (error) {
    console.error('❌ Error ejecutando migraciones en PostgreSQL:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
