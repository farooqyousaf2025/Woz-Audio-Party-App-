require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS installations (
      object_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      installation_id text UNIQUE NOT NULL,
      user_id uuid REFERENCES users(object_id) ON DELETE CASCADE,
      device_token text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_installations_user ON installations (user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_installations_token ON installations (device_token)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id bigserial PRIMARY KEY,
      user_id uuid,
      action text NOT NULL,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs (user_id, created_at DESC)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pushes (
      id bigserial PRIMARY KEY,
      receiver_ids text[] NOT NULL DEFAULT '{}',
      title text,
      body text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      sent boolean NOT NULL DEFAULT false,
      error text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const columns = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
  );
  const names = new Set(columns.rows.map((row) => row.column_name));
  if (!names.has("last_login_at")) await pool.query("ALTER TABLE users ADD COLUMN last_login_at timestamptz");
  if (!names.has("data")) {
    await pool.query("ALTER TABLE users ADD COLUMN data jsonb NOT NULL DEFAULT '{}'::jsonb");
  }

  console.log("Parse-compatibility tables ready: installations, app_config, activity_logs");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
