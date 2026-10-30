const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { signToken, requireAuth } = require("../auth");
const { getUserObject, findUserBy, createUser, setPassword } = require("../users");
const { asyncHandler } = require("../helpers");

const router = express.Router();

function withSession(user) {
  const token = signToken({ object_id: user.objectId, username: user.username, role: user.role });
  return { ...user, sessionToken: token };
}

async function loginAs(row) {
  if (row.account_deleted) throw Object.assign(new Error("account deleted"), { status: 403, code: 143 });
  if (row.activation_status) throw Object.assign(new Error("Access denied, you have been blocked."), { status: 403, code: 143 });
  await pool.query("UPDATE users SET last_login_at = now() WHERE object_id = $1", [row.object_id]);
  return withSession(await getUserObject(pool, row.object_id));
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { username, password, email = null, name = null } = req.body || {};
    if (!username || String(username).trim().length < 3) {
      throw Object.assign(new Error("username must be at least 3 characters"), { status: 400 });
    }
    if (!password || String(password).length < 6) {
      throw Object.assign(new Error("password must be at least 6 characters"), { status: 400 });
    }
    const user = await createUser(pool, { username, password, email, name });
    res.status(201).json(user);
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) throw Object.assign(new Error("username and password are required"), { status: 400 });

    const result = await pool.query("SELECT * FROM users WHERE username = $1", [String(username).trim()]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(String(password), row.password_hash))) {
      throw Object.assign(new Error("invalid credentials"), { status: 401, code: 101 });
    }
    res.json(await loginAs(row));
  })
);

// Providers are matched against an identity the app already obtained; the server trusts
// the supplied uid and links it to an account it owns.
router.post(
  "/social",
  asyncHandler(async (req, res) => {
    const { provider, uid, email = null, name = null, avatarUrl = null } = req.body || {};
    if (!provider || !uid) throw Object.assign(new Error("provider and uid are required"), { status: 400 });

    const identity = `${String(provider).toLowerCase()}:${String(uid)}`;
    const existing = await pool.query("SELECT * FROM users WHERE data ->> 'socialId' = $1", [identity]);
    if (existing.rowCount) return res.json(await loginAs(existing.rows[0]));

    const byEmail = email ? await findUserBy(pool, { email }) : null;
    if (byEmail) {
      await pool.query("UPDATE users SET data = data || jsonb_build_object('socialId', $2) WHERE object_id = $1", [
        byEmail.objectId,
        identity,
      ]);
      return res.json(await loginAs((await pool.query("SELECT * FROM users WHERE object_id = $1", [byEmail.objectId])).rows[0]));
    }

    const username = `${String(provider).toLowerCase()}_${crypto.randomBytes(4).toString("hex")}`;
    const created = await createUser(pool, {
      username,
      password: crypto.randomBytes(18).toString("hex"),
      email,
      name: name || username,
      avatarUrl,
      socialId: identity,
      socialProvider: String(provider).toLowerCase(),
    });
    res.status(201).json(created);
  })
);

router.post(
  "/password-reset",
  asyncHandler(async (req, res) => {
    const identifier = String((req.body || {}).username || (req.body || {}).email || "");
    if (!identifier) throw Object.assign(new Error("username or email is required"), { status: 400 });

    const lookup = await pool.query(
      `SELECT object_id FROM users WHERE username = $1 OR lower(coalesce(email, data ->> 'email')) = lower($1)
        ORDER BY created_at ASC LIMIT 1`,
      [identifier.trim()]
    );
    const target = lookup.rowCount ? lookup.rows[0].object_id : null;

    const code = String(crypto.randomInt(100000, 999999));
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, detail) VALUES ($1, 'password_reset', $2::jsonb)`,
      [target, JSON.stringify({ code, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() })]
    );
    res.json({ sent: false, codeWhileUnconfigured: process.env.SMTP_HOST ? undefined : code });
  })
);

router.post(
  "/password-reset/confirm",
  asyncHandler(async (req, res) => {
    const { username, code, password } = req.body || {};
    if (!username || !code || !password) throw Object.assign(new Error("username, code and password are required"), { status: 400 });
    if (String(password).length < 6) throw Object.assign(new Error("password must be at least 6 characters"), { status: 400 });

    const log = await pool.query(
      `SELECT detail ->> 'code' AS code FROM activity_logs
        WHERE action = 'password_reset' AND user_id = (SELECT object_id FROM users WHERE username = $1)
        ORDER BY created_at DESC LIMIT 1`,
      [String(username).trim()]
    );
    if (!log.rowCount || log.rows[0].code !== String(code)) {
      throw Object.assign(new Error("verification code does not match"), { status: 400, code: 205 });
    }
    const user = await pool.query("SELECT object_id FROM users WHERE username = $1", [String(username).trim()]);
    await setPassword(pool, user.rows[0].object_id, String(password));
    res.json({ updated: true });
  })
);

router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ results: [] });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserObject(pool, req.auth.sub);
    if (!user) return res.status(404).json({ code: 101, error: "user not found" });
    res.json(user);
  })
);

module.exports = router;
