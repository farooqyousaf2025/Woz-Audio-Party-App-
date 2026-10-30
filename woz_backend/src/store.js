const pool = require("./db");
const { objectSource, USER_CLASS } = require("./classes");
const { quote } = require("./schema");
const { Sql, buildWhere, buildOrder, applyOps, encodeBody, isPlainObject } = require("./parse");
const { serializeRow, applyIncludes } = require("./include");
const { getUserObject, createUser, updateUser } = require("./users");
const livequery = require("./livequery");

function sourceFor(className) {
  const source = objectSource(className);
  if (!source) throw Object.assign(new Error(`unknown class ${className}`), { status: 400 });
  return source;
}

function emit(className, before, after) {
  if (!livequery.hasSubscribers(className)) return;
  setImmediate(() => {
    livequery.emit(className, before, after).catch((error) => console.error("livequery:", error.message));
  });
}

async function read(client, source, objectId) {
  if (source.isUser) return getUserObject(client, objectId);
  const result = await client.query(
    `SELECT src.object_id, src.owner_id, src.created_at, src.updated_at, src.data
       FROM ${source.from} ${source.alias} WHERE src.object_id::text = $1`,
    [objectId]
  );
  return result.rowCount ? serializeRow(result.rows[0]) : null;
}

async function get(className, objectId, include = null) {
  const source = sourceFor(className);
  const object = await read(pool, source, objectId);
  if (!object) return null;
  return applyIncludes([object], include).then((list) => list[0]);
}

// Parse's `keys` limiter trims the returned fields; dotted paths keep only the
// root key so the client can lazily fetch the full object later.
function project(object, keys) {
  const wanted = new Set(
    String(keys)
      .split(",")
      .map((key) => key.trim().split(".")[0])
      .filter(Boolean)
  );
  const out = { objectId: object.objectId, createdAt: object.createdAt, updatedAt: object.updatedAt };
  if (object.ownerId !== undefined) out.ownerId = object.ownerId;
  for (const key of Object.keys(object)) {
    if (key === "objectId" || key === "createdAt" || key === "updatedAt" || key === "ownerId") continue;
    if (wanted.has(key)) out[key] = object[key];
  }
  return out;
}

async function list(
  className,
  { where = {}, order = null, limit = 100, skip = 0, include = null, count = false, keys = null } = {}
) {
  const source = sourceFor(className);
  const sql = new Sql();
  const condition = buildWhere(source.alias, where, sql);
  const orderSql = buildOrder(source.alias, order) || "src.updated_at DESC";
  const size = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const offset = Math.max(Number(skip) || 0, 0);

  const rows = await pool.query(
    `SELECT src.object_id, src.owner_id, src.created_at, src.updated_at, src.data
       FROM ${source.from} ${source.alias}
      WHERE ${condition}
      ORDER BY ${orderSql} LIMIT ${sql.add(size)} OFFSET ${sql.add(offset)}`,
    sql.params
  );
  let objects = rows.rows.map(serializeRow);
  if (keys) objects = objects.map((object) => project(object, keys));
  await applyIncludes(objects, include);
  if (!count) return { results: objects };
  const total = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${source.from} ${source.alias} WHERE ${condition}`,
    sql.params.slice(0, sql.params.length - 2)
  );
  return { results: objects, count: total.rows[0].total };
}

async function first(className, { where = {}, order = null, include = null } = {}) {
  const { results } = await list(className, { where, order, limit: 1, include });
  return results[0] || null;
}

async function create(className, body, auth = {}) {
  const source = sourceFor(className);
  if (source.isUser) return createUser(pool, body);

  const data = encodeBody(body);
  for (const key of ["objectId", "createdAt", "updatedAt", "sessionToken", "password"]) delete data[key];
  const insert = await pool.query(
    `INSERT INTO ${quote(source.physical)} (owner_id, data) VALUES ($1, $2::jsonb) RETURNING object_id`,
    [auth.sub || null, JSON.stringify(data)]
  );
  const after = await read(pool, source, insert.rows[0].object_id);
  emit(className, null, after);
  return after;
}

async function update(className, objectId, body) {
  const source = sourceFor(className);
  if (source.isUser) {
    const before = await getUserObject(pool, objectId);
    if (!before) return null;
    const after = await updateUser(pool, objectId, body);
    emit(className, before, after);
    return after;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT object_id FROM ${quote(source.physical)} WHERE object_id::text = $1 FOR UPDATE`, [
      objectId,
    ]);
    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const before = await read(client, source, objectId);
    const raw = await client.query(`SELECT data FROM ${quote(source.physical)} WHERE object_id::text = $1`, [objectId]);
    const next = applyOps(raw.rows[0].data || {}, body);
    await client.query(
      `UPDATE ${quote(source.physical)} SET data = $2::jsonb, updated_at = now() WHERE object_id::text = $1`,
      [objectId, JSON.stringify(next)]
    );
    await client.query("COMMIT");
    const after = await read(client, source, objectId);
    emit(className, before, after);
    return after;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already dropped */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function remove(className, objectId) {
  const source = sourceFor(className);
  const before = await read(pool, source, objectId);
  if (!before) return false;
  if (source.isUser) await pool.query("UPDATE users SET account_deleted = true, updated_at = now() WHERE object_id = $1", [objectId]);
  else await pool.query(`DELETE FROM ${quote(source.physical)} WHERE object_id::text = $1`, [objectId]);
  emit(className, before, null);
  return true;
}

module.exports = { get, list, first, create, update, remove, read, emit, sourceFor };
