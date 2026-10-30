const { objectSource } = require("./classes");

const COMPARISONS = { $gt: ">", $gte: ">=", $lt: "<", $lte: "<=" };
const SUPPORTED = new Set([
  ...Object.keys(COMPARISONS),
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$all",
  "$exists",
  "$regex",
  "$options",
  "$select",
  "$dontSelect",
  "$inQuery",
  "$notInQuery",
]);

const META = {
  objectId: { kind: "uuid", column: "object_id" },
  createdAt: { kind: "tstz", column: "created_at" },
  updatedAt: { kind: "tstz", column: "updated_at" },
  ownerId: { kind: "uuid", column: "owner_id" },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function badRequest(message, code = 105) {
  return Object.assign(new Error(message), { status: 400, code });
}

function isPointer(value) {
  return isPlainObject(value) && value.__type === "Pointer" && typeof value.objectId === "string";
}

function toIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function looksLikeIso(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z$/.test(value);
}

function encodeValue(value) {
  if (Array.isArray(value)) return value.map(encodeValue);
  if (!isPlainObject(value)) return value;
  if (value.__type === "Date") return toIso(value.iso) || value.iso;
  if (value.__type === "Pointer") {
    return { __type: "Pointer", className: value.className, objectId: value.objectId };
  }
  if (value.__type === "Object") {
    if (value.objectId) {
      return { __type: "Pointer", className: value.className, objectId: value.objectId };
    }
    return encodePlain(value);
  }
  if (value.__type === "File") return { __type: "File", name: value.name || null, url: value.url || null };
  if (value.__type === "GeoPoint") {
    return { __type: "GeoPoint", latitude: Number(value.latitude), longitude: Number(value.longitude) };
  }
  return encodePlain(value);
}

function encodePlain(object) {
  const encoded = {};
  for (const [key, value] of Object.entries(object)) {
    if (key === "__type") continue;
    encoded[key] = encodeValue(value);
  }
  return encoded;
}

const META_KEYS = ["objectId", "createdAt", "updatedAt", "className", "__type"];

function encodeBody(body) {
  const encoded = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (META_KEYS.includes(key)) continue;
    encoded[key] = isPlainObject(value) && value.__op ? value : encodeValue(value);
  }
  return encoded;
}

class Sql {
  constructor(params = []) {
    this.params = params;
  }

  add(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  json(value) {
    return `${this.add(JSON.stringify(value))}::jsonb`;
  }
}

function target(alias, key, sql) {
  const parts = String(key).split(".").filter(Boolean);
  if (parts.length === 1 && META[parts[0]]) {
    const meta = META[parts[0]];
    return { kind: meta.kind, expr: `${alias}.${meta.column}` };
  }
  if (parts.length === 1) return { kind: "json", expr: `${alias}.data -> (${sql.add(parts[0])}::text)` };
  return { kind: "json", expr: `${alias}.data #> (${sql.add(parts)}::text[])` };
}

function textOf(node) {
  if (node.kind === "json") return `(${node.expr}) #>> '{}'`;
  return `(${node.expr})::text`;
}

function scalarOf(node) {
  if (node.kind === "json") return `(${node.expr}) #>> '{}'`;
  return `(${node.expr})::text`;
}

// Pointers compare by objectId so two encodings of the same user still match.
function identityOf(node, sql) {
  if (node.kind === "json") {
    return `(CASE WHEN jsonb_typeof(${node.expr}) = 'object' THEN ${node.expr} ->> 'objectId' ELSE ${node.expr} #>> '{}' END)`;
  }
  return `(${node.expr})::text`;
}

function literalFor(node, value, sql) {
  if (node.kind === "tstz") {
    const iso = toIso(value);
    if (!iso) return { sql: "NULL::timestamptz", scalar: null };
    return { sql: `${sql.add(iso)}::timestamptz`, scalar: iso };
  }
  if (node.kind === "uuid") return { sql: sql.add(String(value)), scalar: String(value) };
  return { sql: sql.json(encodeValue(value)), json: true };
}

function eqClause(node, value, sql) {
  if (value === null) {
    return node.kind === "json" ? `${node.expr} = 'null'::jsonb` : `${node.expr} IS NULL`;
  }
  if (isPointer(value)) return `${identityOf(node, sql)} = ${sql.add(value.objectId)}`;
  const literal = literalFor(node, value, sql);
  if (node.kind === "uuid") return `${node.expr}::text = ${literal.sql}`;
  return `${node.expr} = ${literal.sql}`;
}

function inClause(node, values, sql) {
  if (!values.length) return { match: "FALSE", miss: "TRUE" };
  const scalars = values.map((value) => (isPointer(value) ? value.objectId : value));
  if (node.kind !== "json") {
    const list = scalars.map((value) => sql.add(String(value))).join(", ");
    return { match: `${identityOf(node, sql)} IN (${list})`, miss: `${identityOf(node, sql)} NOT IN (${list})` };
  }
  const identity = identityOf(node, sql);
  const match = `(EXISTS (SELECT 1 FROM jsonb_array_elements(${sql.json(values.map(encodeValue))}) AS q(v)
                 WHERE ${node.expr} = q.v
                    OR (${identity} = q.v #>> '{}')
                    OR (${identity} = q.v ->> 'objectId')
                    OR (jsonb_typeof(${node.expr}) = 'array' AND ${node.expr} @> jsonb_build_array(q.v))))`;
  return { match, miss: `NOT ${match}` };
}

function compareClause(node, value, operator, sql) {
  const op = COMPARISONS[operator];
  if (node.kind === "tstz" || node.kind === "uuid") {
    const literal = literalFor(node, value, sql);
    if (literal.sql === "NULL::timestamptz") return "FALSE";
    if (node.kind === "uuid") return `${node.expr}::text ${op} ${sql.add(String(value))}`;
    return `${node.expr} ${op} ${literal.sql}`;
  }
  if (typeof value === "number") {
    const left = `(CASE WHEN jsonb_typeof(${node.expr}) = 'number' THEN (${node.expr}) #>> '{}' END)::numeric`;
    return `${left} ${op} ${sql.add(value)}::numeric`;
  }
  const iso = looksLikeIso(value) ? value : toIso(value);
  if (typeof value === "string" && iso && /[T]\d{2}:\d{2}/.test(value)) {
    return `${scalarOf(node)} ${op} ${sql.add(iso)}`;
  }
  if (typeof value === "boolean") {
    return `${node.expr} ${op} ${sql.json(value)}`;
  }
  return `${scalarOf(node)} ${op} ${sql.add(String(value))}`;
}

function subQueryClause(spec, node, sql, negated) {
  const normalized = normalizeSubQuery(spec);
  if (!normalized) throw badRequest("unsupported sub-query constraint");
  const { className, key, where } = normalized;
  const source = objectSource(className);
  if (!source) throw badRequest(`unknown class ${className}`, 103);
  const inner = new Sql(sql.params);
  sql.params = inner.params;
  const innerWhere = buildWhere(source.alias, where || {}, inner);
  const keyNode = target(source.alias, key, inner);
  return `${identityOf(node, sql)} ${negated ? "NOT IN" : "IN"} (
            SELECT COALESCE(${identityOf(keyNode, inner)}, 'null'::text)
              FROM ${source.from} ${source.alias}
             WHERE ${innerWhere} AND ${keyNode.expr} IS NOT NULL
          )`;
}

// Parse nests the inner query as {query:{className,where}, keys:[...]} while
// $inQuery/$notInQuery carry {className,where} and always match on objectId.
function normalizeSubQuery(spec) {
  if (!isPlainObject(spec)) return null;
  if (spec.className && spec.key) return spec;
  const inner = isPlainObject(spec.query) ? spec.query : null;
  if (inner && inner.className) {
    const key = Array.isArray(spec.keys) && spec.keys.length ? spec.keys[0] : spec.key;
    return { className: inner.className, where: inner.where || {}, key: key || "objectId" };
  }
  if (spec.className) {
    return { className: spec.className, where: spec.where || {}, key: "objectId" };
  }
  return null;
}

function operatorClause(node, operator, operand, options, sql) {
  switch (operator) {
    case "$eq":
      return eqClause(node, operand, sql);
    case "$ne":
      return `NOT (${eqClause(node, operand, sql)})`;
    case "$exists":
      return operand ? `${node.expr} IS NOT NULL` : `${node.expr} IS NULL`;
    case "$in":
    case "$nin": {
      if (!Array.isArray(operand)) throw badRequest(`${operator} needs a list`);
      const clause = inClause(node, operand, sql);
      return operator === "$in" ? clause.match : clause.miss;
    }
    case "$all": {
      if (!Array.isArray(operand) || !operand.length) return "FALSE";
      return `${node.expr} @> ${sql.json(operand.map(encodeValue))}`;
    }
    case "$regex": {
      const pattern = translateParseRegex(String(operand));
      const caseInsensitive = /i/.test(options || "");
      return `${textOf(node)} ${caseInsensitive ? "~*" : "~"} ${sql.add(pattern)}`;
    }
    case "$select":
      return subQueryClause(operand, node, sql, false);
    case "$dontSelect":
      return subQueryClause(operand, node, sql, true);
    case "$inQuery":
      return subQueryClause(operand, node, sql, false);
    case "$notInQuery":
      return subQueryClause(operand, node, sql, true);
    default:
      if (COMPARISONS[operator]) return compareClause(node, operand, operator, sql);
      throw badRequest(`unsupported query operator ${operator}`);
  }
}

function translateParseRegex(pattern) {
  // Parse quotes literal spans with \Q...\E; POSIX regex has no such marker.
  return pattern.replace(/\\Q([\s\S]*?)\\E/g, (_whole, literal) =>
    String(literal).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function buildWhere(alias, where, sql) {
  const fragments = [];
  for (const [key, constraint] of Object.entries(where || {})) {
    if (key === "$or" || key === "$and" || key === "$nor") {
      if (!Array.isArray(constraint) || !constraint.length) throw badRequest(`${key} needs a list`);
      const joiner = key === "$and" ? " AND " : " OR ";
      const joined = constraint.map((sub) => buildWhere(alias, sub, sql)).join(joiner);
      fragments.push(key === "$nor" ? `NOT (${joined})` : `(${joined})`);
      continue;
    }
    const node = target(alias, key, sql);
    if (isPlainObject(constraint) && Object.keys(constraint).some((k) => k.startsWith("$"))) {
      const options = typeof constraint.$options === "string" ? constraint.$options : "";
      const inner = [];
      for (const [operator, operand] of Object.entries(constraint)) {
        if (operator === "$options") continue;
        if (operator === "$relatedTo" || operator === "$nearSphere" || operator === "$within") {
          throw badRequest(`unsupported geo/relationship operator ${operator}`);
        }
        if (!SUPPORTED.has(operator)) throw badRequest(`unsupported query operator ${operator}`);
        inner.push(operatorClause(node, operator, operand, options, sql));
      }
      fragments.push(`(${inner.join(" AND ")})`);
      continue;
    }
    fragments.push(eqClause(node, constraint, sql));
  }
  return fragments.length ? fragments.join(" AND ") : "TRUE";
}

function buildOrder(alias, order) {
  const terms = String(order || "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) return null;
  return terms
    .map((term) => {
      const descending = term.startsWith("-");
      const key = descending ? term.slice(1) : term.replace(/^\+/, "");
      const meta = META[key];
      const direction = descending ? "DESC" : "ASC";
      if (meta) return `${alias}.${meta.column} ${direction} NULLS LAST`;
      if (key.includes(".")) return null;
      const placeholder = `'${key.replace(/'/g, "''")}'`;
      return `(CASE WHEN jsonb_typeof(${alias}.data -> ${placeholder}) = 'number'
                THEN (${alias}.data -> ${placeholder}) #>> '{}' END)::numeric ${direction} NULLS LAST,
              (${alias}.data -> ${placeholder}) #>> '{}' ${direction} NULLS LAST`;
    })
    .filter(Boolean)
    .join(", ");
}

function sameValue(a, b) {
  if (isPointer(a) && isPointer(b)) return a.objectId === b.objectId && a.className === b.className;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function applyOps(data, body) {
  const next = { ...data };
  for (const [key, value] of Object.entries(body || {})) {
    if (META_KEYS.includes(key)) continue;
    if (!isPlainObject(value) || !value.__op) {
      next[key] = encodeValue(value);
      continue;
    }
    switch (value.__op) {
      case "Delete":
        delete next[key];
        break;
      case "Increment":
      case "Decrement": {
        const amount = Number(value.amount ?? 1) * (value.__op === "Decrement" ? -1 : 1);
        const current = typeof next[key] === "number" ? next[key] : Number(value.default ?? 0);
        next[key] = current + amount;
        break;
      }
      case "Add":
      case "AddUnique": {
        const current = Array.isArray(next[key]) ? [...next[key]] : next[key] === undefined ? [] : [next[key]];
        const incoming = Array.isArray(value.objects) ? value.objects : [value.object];
        for (const item of incoming) {
          const encoded = encodeValue(item);
          const exists = current.some((entry) => sameValue(entry, encoded));
          if (value.__op === "AddUnique" && exists) continue;
          current.push(encoded);
        }
        next[key] = current;
        break;
      }
      case "Remove":
      case "RemoveAll": {
        const current = Array.isArray(next[key]) ? next[key] : [];
        const incoming = Array.isArray(value.objects) ? value.objects : [value.object];
        next[key] = current.filter((entry) => !incoming.some((item) => sameValue(entry, encodeValue(item))));
        break;
      }
      case "Concatenate":
        next[key] = Array.isArray(value.value) ? value.value.map(encodeValue) : encodeValue(value.value);
        break;
      default:
        throw badRequest(`unsupported update operator ${value.__op}`);
    }
  }
  return next;
}

module.exports = {
  Sql,
  META_KEYS,
  buildWhere,
  buildOrder,
  encodeBody,
  encodeValue,
  applyOps,
  isPointer,
  isPlainObject,
  looksLikeIso,
  toIso,
  target,
};
