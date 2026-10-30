const pool = require("./db");
const { objectSource } = require("./classes");
const { isPointer, isPlainObject, Sql, buildWhere } = require("./parse");

function pathsFrom(include) {
  if (!include) return [];
  const list = Array.isArray(include) ? include : String(include).split(",");
  return list.map((path) => String(path).trim()).filter(Boolean);
}

function serializeRow(row) {
  return {
    objectId: row.object_id,
    ownerId: row.owner_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    ...(row.data || {}),
  };
}

async function fetchByIds(className, ids) {
  const source = objectSource(className);
  if (!source || !ids.length) return new Map();
  const sql = new Sql();
  const list = ids.map((id) => sql.add(id)).join(", ");
  const result = await pool.query(
    `SELECT src.object_id, src.owner_id, src.created_at, src.updated_at, src.data
       FROM ${source.from} ${source.alias}
      WHERE src.object_id::text IN (${list})`,
    sql.params
  );
  const found = new Map();
  for (const row of result.rows) found.set(row.object_id, serializeRow(row));
  return found;
}

async function resolvePath(objects, path) {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length || !objects.length) return;

  let current = objects;
  for (let depth = 0; depth < parts.length - 1; depth += 1) {
    const next = [];
    for (const object of current) {
      const value = object ? object[parts[depth]] : null;
      if (isPlainObject(value)) next.push(value);
    }
    current = next;
    if (!current.length) return;
  }

  const leaf = parts[parts.length - 1];
  const pending = new Map();
  const holders = [];
  for (const object of current) {
    const value = object ? object[leaf] : null;
    if (!isPointer(value)) continue;
    holders.push({ holder: object, key: leaf, pointer: value });
    if (!pending.has(value.className)) pending.set(value.className, new Set());
    pending.get(value.className).add(value.objectId);
  }
  if (!pending.size) return;

  const loaded = new Map();
  for (const [targetClass, ids] of pending) {
    const rows = await fetchByIds(targetClass, [...ids]);
    for (const [id, row] of rows) loaded.set(`${targetClass}:${id}`, row);
  }

  for (const { holder, key, pointer } of holders) {
    const full = loaded.get(`${pointer.className}:${pointer.objectId}`);
    holder[key] = full ? { __type: "Object", className: pointer.className, ...full } : null;
  }
}

async function applyIncludes(objects, include) {
  for (const path of pathsFrom(include)) await resolvePath(objects, path);
  return objects;
}

// LiveQuery membership is evaluated with the same compiler the REST queries use.
function matchesWhere(where, row) {
  const sql = new Sql([
    JSON.stringify(row.data || {}),
    row.objectId,
    row.createdAt || null,
    row.updatedAt || null,
    row.ownerId || null,
  ]);
  const condition = buildWhere("src", where || {}, sql);
  return pool
    .query(
      `SELECT (CASE WHEN ${condition} THEN 1 ELSE 0 END) AS hit
         FROM (SELECT $1::jsonb AS data, $2::text AS object_id,
                      $3::timestamptz AS created_at,
                      $4::timestamptz AS updated_at,
                      $5::text AS owner_id) src`,
      sql.params
    )
    .then((result) => result.rows[0].hit === 1)
    .catch(() => false);
}

function toMatchRow(object) {
  if (!object) return null;
  const { objectId, ownerId, createdAt, updatedAt, ...rest } = object;
  return { objectId, ownerId, createdAt, updatedAt, data: rest };
}

module.exports = { applyIncludes, serializeRow, matchesWhere, pathsFrom, fetchByIds, toMatchRow };
