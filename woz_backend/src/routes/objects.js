const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../auth");
const { objectSource, INSTALLATION_CLASS } = require("../classes");
const { encodeBody, isPlainObject } = require("../parse");
const store = require("../store");
const { asyncHandler, toInt } = require("../helpers");

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(requireAuth);

function parseWhere(raw) {
  if (!raw) return {};
  if (isPlainObject(raw)) return raw;
  return JSON.parse(String(raw));
}

async function upsertInstallation(body, auth) {
  const installationId = String(body.installationId || body.objectId || "");
  if (!installationId) throw Object.assign(new Error("installationId is required"), { status: 400 });
  const pointerUserId = isPlainObject(body.user) ? String(body.user.objectId || "") : "";
  const userId = UUID.test(pointerUserId) ? pointerUserId : UUID.test(String(auth.sub)) ? auth.sub : null;
  const data = encodeBody(body);
  for (const key of ["objectId", "createdAt", "updatedAt", "user"]) delete data[key];

  const result = await pool.query(
    `INSERT INTO installations (installation_id, user_id, device_token, data)
     VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (installation_id) DO UPDATE
       SET user_id = COALESCE(EXCLUDED.user_id, installations.user_id),
           device_token = COALESCE(EXCLUDED.device_token, installations.device_token),
           data = installations.data || EXCLUDED.data,
           updated_at = now()
     RETURNING object_id`,
    [
      installationId,
      userId,
      typeof body.deviceToken === "string" ? body.deviceToken : null,
      JSON.stringify(data),
    ]
  );
  return store.read(pool, objectSource(INSTALLATION_CLASS), result.rows[0].object_id);
}

router.get(
  "/:className",
  asyncHandler(async (req, res) => {
    if (!objectSource(req.params.className)) return res.status(404).json({ error: "unknown class" });
    let where;
    try {
      where = parseWhere(req.query.where);
    } catch {
      return res.status(400).json({ error: "invalid where" });
    }
    const wantCount = req.query.count === "1" || req.query.count === "true";
    const { results, count } = await store.list(req.params.className, {
      where,
      order: req.query.order,
      limit: toInt(req.query.limit, 100),
      skip: toInt(req.query.skip, 0),
      include: req.query.include,
      keys: req.query.keys,
      count: wantCount,
    });
    res.json(wantCount ? { results, count } : { results });
  })
);

router.get(
  "/:className/:objectId",
  asyncHandler(async (req, res) => {
    if (!objectSource(req.params.className)) return res.status(404).json({ error: "unknown class" });
    if (!UUID.test(req.params.objectId)) return res.status(400).json({ error: "invalid objectId" });
    const object = await store.get(req.params.className, req.params.objectId, req.query.include);
    if (!object) return res.status(404).json({ code: 101, error: "Object not found." });
    res.json(object);
  })
);

router.post(
  "/:className",
  asyncHandler(async (req, res) => {
    if (!objectSource(req.params.className)) return res.status(404).json({ error: "unknown class" });
    if (!isPlainObject(req.body)) return res.status(400).json({ error: "body must be an object" });
    if (req.params.className === INSTALLATION_CLASS) {
      return res.status(201).json(await upsertInstallation(req.body, req.auth));
    }
    const created = await store.create(req.params.className, req.body, req.auth);
    res.status(201).json(created);
  })
);

const updateHandler = asyncHandler(async (req, res) => {
  const className = req.params.className;
  if (!objectSource(className)) return res.status(404).json({ error: "unknown class" });
  if (!UUID.test(req.params.objectId)) return res.status(400).json({ error: "invalid objectId" });
  if (!isPlainObject(req.body)) return res.status(400).json({ error: "body must be an object" });

  if (className === INSTALLATION_CLASS) {
    return res.json(await upsertInstallation({ ...req.body, installationId: req.params.objectId }, req.auth));
  }
  if (className === "_User" && req.params.objectId !== req.auth.sub && req.auth.role !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }

  const updated = await store.update(className, req.params.objectId, req.body);
  if (!updated) return res.status(404).json({ code: 101, error: "Object not found." });
  res.json({ updatedAt: updated.updatedAt, objectId: updated.objectId });
});

router.put("/:className/:objectId", updateHandler);
router.patch("/:className/:objectId", updateHandler);

router.delete(
  "/:className/:objectId",
  asyncHandler(async (req, res) => {
    const className = req.params.className;
    const source = objectSource(className);
    if (!source) return res.status(404).json({ error: "unknown class" });
    if (!UUID.test(req.params.objectId)) return res.status(400).json({ error: "invalid objectId" });

    const existing = await store.get(className, req.params.objectId);
    if (!existing) return res.status(404).json({ code: 101, error: "Object not found." });
    const isUser = className === "_User";
    const owner = isUser ? existing.objectId : existing.ownerId;
    if (owner && owner !== req.auth.sub && req.auth.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    await store.remove(className, req.params.objectId);
    res.json({ results: [] });
  })
);

module.exports = router;
