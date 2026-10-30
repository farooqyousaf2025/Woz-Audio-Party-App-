const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { signToken, verifyToken } = require("./auth");
const { asyncHandler, toInt, publicUser } = require("./helpers");
const { schema } = require("./schema");

const COOKIE = "woz_admin";
const APP_NAME = "Woz Audio Party App";
const router = express.Router();

function setAdminCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function loadAdmin(req, res, next) {
  const payload = verifyToken(req.cookies[COOKIE]);
  if (!payload) return next();
  pool
    .query("SELECT * FROM users WHERE object_id = $1", [payload.sub])
    .then((result) => {
      const user = result.rows[0];
      if (user && user.role === "admin") req.admin = publicUser(user);
      next();
    })
    .catch(next);
}

function requireAdminPage(req, res, next) {
  if (!req.admin) return res.redirect("/admin/login");
  next();
}

router.use(loadAdmin);

router.get("/login", (req, res) => {
  if (req.admin) return res.redirect("/admin");
  res.render("login", { appName: APP_NAME, error: req.query.error || null });
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [(username || "").trim()]);
    const user = result.rows[0];
    if (!user || user.role !== "admin" || !(await bcrypt.compare(password || "", user.password_hash))) {
      return res.redirect("/admin/login?error=invalid");
    }
    setAdminCookie(res, signToken(user));
    res.redirect("/admin");
  })
);

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE);
  res.redirect("/admin/login");
});

router.get("/", requireAdminPage, asyncHandler(async (req, res) => {
  const counts = {};
  const query = async (label, sql, params = []) => {
    const result = await pool.query(sql, params);
    counts[label] = Number(result.rows[0].total);
  };

  await query("users", "SELECT COUNT(*)::int AS total FROM users");
  await query("registeredToday", "SELECT COUNT(*)::int AS total FROM users WHERE created_at >= now() - interval '24 hours'");
  await query("blocked", "SELECT COUNT(*)::int AS total FROM users WHERE activation_status = true OR account_deleted = true");
  await query("models", "SELECT COUNT(*)::int AS total FROM schema_models");

  const dynamic = {};
  for (const className of ["Posts", "Message", "Streaming", "Comments", "Stories"]) {
    const model = schema.models.find((entry) => entry.className === className);
    if (!model) continue;
    const result = await pool.query(`SELECT COUNT(*)::int AS total FROM "${model.table.replace(/"/g, '""')}"`);
    dynamic[className] = Number(result.rows[0].total);
  }

  const recent = await pool.query(
    "SELECT object_id, username, name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 8"
  );

  res.render("dashboard", {
    appName: APP_NAME,
    admin: req.admin,
    counts,
    dynamic,
    recentUsers: recent.rows,
  });
}));

router.get("/models", requireAdminPage, asyncHandler(async (req, res) => {
  const result = await pool.query(
    "SELECT class_name, table_name, dart_file, fields FROM schema_models ORDER BY class_name"
  );
  res.render("models", { appName: APP_NAME, admin: req.admin, models: result.rows });
}));

router.get("/users", requireAdminPage, asyncHandler(async (req, res) => {
  const search = (req.query.q || "").trim();
  const page = Math.max(toInt(req.query.page, 1), 1);
  const perPage = 25;
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(username ILIKE $1 OR COALESCE(name, '') ILIKE $1 OR COALESCE(email, '') ILIKE $1)`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = await pool.query(`SELECT COUNT(*)::int AS total FROM users ${where}`, params);
  const rows = await pool.query(
    `SELECT object_id, username, name, email, role, credit, diamonds, activation_status, account_deleted, created_at
     FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, (page - 1) * perPage]
  );

  res.render("users", {
    appName: APP_NAME,
    admin: req.admin,
    users: rows.rows,
    search,
    page,
    perPage,
    total: Number(total.rows[0].total),
    saved: req.query.saved || null,
  });
}));

router.get(
  "/users/:id",
  requireAdminPage,
  asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT * FROM users WHERE object_id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).render("error", { appName: APP_NAME, admin: req.admin, message: "User not found" });
    res.render("user_edit", {
      appName: APP_NAME,
      admin: req.admin,
      user: result.rows[0],
      saved: req.query.saved || null,
    });
  })
);

router.post(
  "/users/:id",
  requireAdminPage,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const fields = {
      name: (body.name || "").trim() || null,
      email: (body.email || "").trim() || null,
      role: body.role === "admin" ? "admin" : "user",
      credit: toInt(body.credit, 0),
      diamonds: toInt(body.diamonds, 0),
      diamonds_total: toInt(body.diamonds_total, 0),
      p_coins: toInt(body.p_coins, 0),
      activation_status: body.activation_status === "on",
      account_deleted: body.account_deleted === "on",
    };

    if (body.password) {
      const hash = await bcrypt.hash(body.password, 10);
      await pool.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE object_id = $2", [hash, req.params.id]);
    }

    await pool.query(
      `UPDATE users
       SET name = $1, email = $2, role = $3, credit = $4, diamonds = $5, diamonds_total = $6,
           p_coins = $7, activation_status = $8, account_deleted = $9, updated_at = now()
       WHERE object_id = $10`,
      [
        fields.name,
        fields.email,
        fields.role,
        fields.credit,
        fields.diamonds,
        fields.diamonds_total,
        fields.p_coins,
        fields.activation_status,
        fields.account_deleted,
        req.params.id,
      ]
    );

    res.redirect(`/admin/users/${req.params.id}?saved=1`);
  })
);

module.exports = router;
