const { getModel, quote } = require("./schema");

const USER_CLASS = "_User";
const INSTALLATION_CLASS = "_Installation";

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// A uniform row source: every class exposes object_id / owner_id / created_at / updated_at / data.
function objectSource(className) {
  if (className === USER_CLASS) {
    const merged = `(jsonb_build_object(
        'objectId', u.object_id,
        'username', u.username,
        'email', u.email,
        'name', u.name,
        'role', u.role,
        'avatarUrl', u.avatar_url,
        'credit', u.credit,
        'diamonds', u.diamonds,
        'diamondsTotal', u.diamonds_total,
        'pCoins', u.p_coins,
        'password', NULL,
        'sessionToken', NULL,
        'activationStatus', u.activation_status,
        'accountDeleted', u.account_deleted
      ) || COALESCE(u.data, '{}'::jsonb))`;
    return {
      className,
      model: { className, table: "users" },
      physical: "users",
      isUser: true,
      alias: "src",
      from: `(SELECT u.object_id, u.object_id AS owner_id, u.created_at, u.updated_at, ${merged} AS data FROM users u)`,
    };
  }
  if (className === INSTALLATION_CLASS) {
    return {
      className,
      model: { className, table: "installations" },
      physical: "installations",
      isUser: false,
      alias: "src",
      from: `(SELECT i.object_id, i.user_id AS owner_id, i.created_at, i.updated_at,
                (COALESCE(i.data, '{}'::jsonb) || jsonb_build_object(
                  'objectId', i.object_id,
                  'installationId', i.installation_id,
                  'deviceToken', i.device_token,
                  'user', CASE WHEN i.user_id IS NULL THEN NULL
                        ELSE jsonb_build_object('__type', 'Pointer', 'className', '_User', 'objectId', i.user_id) END
                )) AS data
              FROM installations i)`,
    };
  }
  const model = getModel(className);
  if (!model) return null;
  const table = quote(model.table);
  return {
    className,
    model,
    physical: model.table,
    isUser: false,
    alias: "src",
    from: `(SELECT t.object_id, t.owner_id, t.created_at, t.updated_at, COALESCE(t.data, '{}'::jsonb) AS data FROM ${table} t)`,
  };
}

// Writes must never leak the credential columns into the jsonb document.
function sanitizeStored(object) {
  if (!object || typeof object !== "object") return object;
  const copy = { ...object };
  for (const key of ["password", "sessionToken", "password_hash"]) delete copy[key];
  return copy;
}

module.exports = { USER_CLASS, INSTALLATION_CLASS, objectSource, sanitizeStored, quoteLiteral };
