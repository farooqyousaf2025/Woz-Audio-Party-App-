const bcrypt = require("bcryptjs");
const { objectSource, USER_CLASS } = require("./classes");
const { applyOps, encodeBody, META_KEYS } = require("./parse");
const { serializeRow } = require("./include");
const { signToken } = require("./auth");
const { toInt } = require("./helpers");

const USER_COLUMNS = {
  username: (merged) => (typeof merged.username === "string" ? merged.username : null),
  email: (merged) => (typeof merged.email === "string" ? merged.email : null),
  name: (merged) => (typeof merged.name === "string" ? merged.name : null),
  role: (merged) => (typeof merged.role === "string" ? merged.role : "user"),
  avatar_url: (merged) => {
    if (typeof merged.avatarUrl === "string") return merged.avatarUrl;
    if (merged.avatar && typeof merged.avatar === "object" && typeof merged.avatar.url === "string") {
      return merged.avatar.url;
    }
    return null;
  },
  credit: (merged) => toInt(merged.credit, 0),
  diamonds: (merged) => toInt(merged.diamonds, 0),
  diamonds_total: (merged) => toInt(merged.diamondsTotal ?? merged.diamonds_total, 0),
  p_coins: (merged) => toInt(merged.pCoins ?? merged.p_coins, 0),
  activation_status: (merged) => Boolean(merged.activationStatus ?? merged.activation_status),
  account_deleted: (merged) => Boolean(merged.accountDeleted ?? merged.account_deleted),
};

const SOURCE = objectSource(USER_CLASS);

function stripMeta(object) {
  const copy = { ...object };
  for (const key of [...META_KEYS, "sessionToken", "password", "className"]) delete copy[key];
  return copy;
}

async function getUserObject(client, objectId) {
  const result = await client.query(
    `SELECT src.object_id, src.owner_id, src.created_at, src.updated_at, src.data
       FROM ${SOURCE.from} ${SOURCE.alias} WHERE src.object_id::text = $1`,
    [objectId]
  );
  return result.rowCount ? serializeRow(result.rows[0]) : null;
}

async function findUserBy(client, { username = null, email = null, phone = null }) {
  const params = [];
  const clauses = [];
  if (username) {
    params.push(username);
    clauses.push(`username = $${params.length}`);
  }
  if (email) {
    params.push(String(email).toLowerCase());
    clauses.push(`lower(coalesce(email, data ->> 'email')) = $${params.length}`);
  }
  if (phone) {
    params.push(phone);
    const index = params.length;
    clauses.push(`(data ->> 'phoneNumberFull') = $${index} OR username = $${index}`);
  }
  if (!clauses.length) return null;
  const result = await client.query(
    `SELECT object_id FROM users WHERE ${clauses.join(" OR ")} ORDER BY created_at ASC LIMIT 1`,
    params
  );
  return result.rowCount ? getUserObject(client, result.rows[0].object_id) : null;
}

async function createUser(client, body) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username) throw Object.assign(new Error("username is required"), { status: 400 });
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6) {
    throw Object.assign(new Error("password must be at least 6 characters"), { status: 400 });
  }
  const clash = await client.query("SELECT 1 FROM users WHERE username = $1", [username]);
  if (clash.rowCount) throw Object.assign(new Error("username already taken"), { status: 409 });

  const data = stripMeta(encodeBody(body));
  const merged = { ...data, username, email: typeof body.email === "string" ? body.email : null };
  const hash = await bcrypt.hash(password, 10);
  const result = await client.query(
    `INSERT INTO users (username, email, name, role, avatar_url, credit, diamonds, diamonds_total, p_coins,
                        activation_status, account_deleted, password_hash, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING object_id`,
    [
      username,
      USER_COLUMNS.email(merged),
      USER_COLUMNS.name(merged),
      USER_COLUMNS.role(merged),
      USER_COLUMNS.avatar_url(merged),
      USER_COLUMNS.credit(merged),
      USER_COLUMNS.diamonds(merged),
      USER_COLUMNS.diamonds_total(merged),
      USER_COLUMNS.p_coins(merged),
      USER_COLUMNS.activation_status(merged),
      USER_COLUMNS.account_deleted(merged),
      hash,
      JSON.stringify(data),
    ]
  );
  const created = await getUserObject(client, result.rows[0].object_id);
  const sessionToken = signToken({ object_id: created.objectId, username: created.username, role: created.role });
  return { ...created, sessionToken };
}

async function updateUser(client, objectId, body) {
  const current = await getUserObject(client, objectId);
  if (!current) throw Object.assign(new Error("user not found"), { status: 404 });

  const merged = applyOps(current, body);
  for (const key of ["objectId", "createdAt", "updatedAt", "className", "sessionToken", "password"]) {
    delete merged[key];
  }
  const password = typeof body.password === "string" && body.password.length >= 6 ? body.password : null;
  const data = stripMeta(merged);

  const sets = ["data = $2::jsonb", "updated_at = now()"];
  const params = [objectId, JSON.stringify(data)];
  for (const [column, extract] of Object.entries(USER_COLUMNS)) {
    if (column === "username" && merged.username === undefined) continue;
    params.push(extract(merged));
    sets.push(`"${column}" = $${params.length}`);
  }
  if (password) {
    params.push(await bcrypt.hash(password, 10));
    sets.push(`password_hash = $${params.length}`);
  }
  await client.query(`UPDATE users SET ${sets.join(", ")} WHERE object_id::text = $1 RETURNING object_id`, params);
  return getUserObject(client, objectId);
}

async function setPassword(client, objectId, password) {
  const hash = await bcrypt.hash(password, 10);
  await client.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE object_id::text = $1", [
    objectId,
    hash,
  ]);
}

module.exports = { USER_COLUMNS, stripMeta, getUserObject, findUserBy, createUser, updateUser, setPassword };
