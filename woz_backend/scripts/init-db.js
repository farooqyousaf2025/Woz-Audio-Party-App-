require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "schema.json"), "utf8"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const quote = (identifier) => `"${identifier.replace(/"/g, '""')}"`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        object_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username text UNIQUE NOT NULL,
        email text,
        password_hash text NOT NULL,
        name text,
        role text NOT NULL DEFAULT 'user',
        avatar_url text,
        credit integer NOT NULL DEFAULT 0,
        diamonds integer NOT NULL DEFAULT 0,
        diamonds_total integer NOT NULL DEFAULT 0,
        p_coins integer NOT NULL DEFAULT 0,
        activation_status boolean NOT NULL DEFAULT false,
        account_deleted boolean NOT NULL DEFAULT false,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_models (
        class_name text PRIMARY KEY,
        table_name text NOT NULL,
        dart_file text NOT NULL,
        fields jsonb NOT NULL DEFAULT '[]'::jsonb
      )
    `);

    for (const model of schema.models) {
      await client.query(
        `INSERT INTO schema_models (class_name, table_name, dart_file, fields)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (class_name) DO UPDATE SET
           table_name = EXCLUDED.table_name,
           dart_file = EXCLUDED.dart_file,
           fields = EXCLUDED.fields`,
        [model.className, model.table, model.dartFile, JSON.stringify(model.fields)]
      );

      if (model.className === "_User") continue;

      const table = quote(model.table);
      const indexBase = model.table.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          object_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_id uuid REFERENCES users(object_id) ON DELETE SET NULL,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${indexBase}_updated ON ${table} (updated_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${indexBase}_owner ON ${table} (owner_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${indexBase}_data ON ${table} USING gin (data jsonb_path_ops)`);
    }

    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error("ADMIN_PASSWORD must be set in .env before seeding the admin account");
    const existing = await client.query("SELECT object_id FROM users WHERE username = $1", [username]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(password, 10);
      await client.query(
        `INSERT INTO users (username, email, password_hash, name, role)
         VALUES ($1, $2, $3, $4, 'admin')`,
        [username, "admin@woz.local", hash, "Administrator"]
      );
      console.log(`Seeded admin user "${username}"`);
    } else {
      console.log(`Admin user "${username}" already exists`);
    }

    const tables = await client.query(
      "SELECT COUNT(*)::int AS models FROM schema_models"
    );
    console.log(`Schema ready: ${tables.rows[0].models} models registered`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
