import { pool } from './client.js';

const schemaSQL = `
  CREATE TABLE IF NOT EXISTS check_in_groups (
    id UUID PRIMARY KEY,
    group_code VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS passengers (
    id UUID PRIMARY KEY,
    group_id UUID REFERENCES check_in_groups(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    document_number VARCHAR(50) NOT NULL,
    birth_date DATE NOT NULL,
    is_vip BOOLEAN DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS cabins (
    id VARCHAR(100) PRIMARY KEY,
    cabin_number VARCHAR(20) NOT NULL,
    deck VARCHAR(20),
    capacity INT NOT NULL DEFAULT 2,
    occupied INT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS check_ins (
    id UUID PRIMARY KEY,
    passenger_id UUID REFERENCES passengers(id) ON DELETE CASCADE,
    cabin_id VARCHAR(100) REFERENCES cabins(id) ON DELETE SET NULL,
    status VARCHAR(30) DEFAULT 'PENDING',
    qr_payload TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY,
    check_in_id UUID REFERENCES check_ins(id) ON DELETE CASCADE,
    external_transaction_id VARCHAR(100),
    amount_cents INT NOT NULL,
    concept VARCHAR(100) DEFAULT 'CHECK_IN',
    status VARCHAR(30) DEFAULT 'PAID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS luggage (
    id UUID PRIMARY KEY,
    check_in_id UUID REFERENCES check_ins(id) ON DELETE CASCADE,
    bag_count INT NOT NULL,
    total_weight_kg NUMERIC(6,2) NOT NULL,
    extra_fee_cents INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

async function runMigrations() {
  console.log('🔄 Ejecutando migraciones en PostgreSQL...');
  try {
    await pool.query(schemaSQL);
    console.log('✅ Tablas de PostgreSQL verificadas/creadas correctamente.');
  } catch (error) {
    console.error('❌ Error ejecutando migraciones en PostgreSQL:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
