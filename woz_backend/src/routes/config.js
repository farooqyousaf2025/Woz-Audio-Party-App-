const express = require("express");
const pool = require("../db");
const { requireAuth, requireAdmin } = require("../auth");
const { encodeValue, isPlainObject } = require("../parse");
const { asyncHandler } = require("../helpers");

const router = express.Router();

const DEFAULTS = {
  facebook_login: false,
  phone_login: false,
  apple_login: false,
  google_login: false,
  calls_enabled: true,
  stream_type: "webrtc",
  stream_key: "",
  withdraw_paypal: true,
  withdraw_payoneer: false,
  withdraw_bank: true,
  withdraw_usdt: false,
  agency_percent: 5,
  diamonds_earn_percent: 50,
  diamonds_needed_to_redeem: 1000,
  withdraw_percent: 70,
  s3_region: "",
  s3_bucket: "",
  s3_url: "",
  s3_access_key: "",
  s3_secret_key: "",
  banner_ads_reels: false,
};

async function readConfig() {
  const result = await pool.query("SELECT key, value FROM app_config");
  const params = { ...DEFAULTS };
  for (const row of result.rows) params[row.key] = row.value;
  return params;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ params: await readConfig() });
  })
);

router.put(
  "/",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!isPlainObject(req.body)) return res.status(400).json({ error: "body must be an object" });
    for (const [key, value] of Object.entries(req.body)) {
      await pool.query(
        `INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(encodeValue(value))]
      );
    }
    res.json({ params: await readConfig() });
  })
);

module.exports = router;
