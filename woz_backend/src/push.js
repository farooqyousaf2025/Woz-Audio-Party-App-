const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const SERVICE_ACCOUNT = process.env.FCM_SERVICE_ACCOUNT
  ? JSON.parse(fs.readFileSync(path.resolve(process.env.FCM_SERVICE_ACCOUNT), "utf8"))
  : null;
const PROJECT_ID = process.env.FCM_PROJECT_ID || (SERVICE_ACCOUNT ? SERVICE_ACCOUNT.project_id : null);

let cachedToken = { value: null, expiresAt: 0 };

async function accessToken() {
  if (!SERVICE_ACCOUNT) return null;
  if (cachedToken.value && Date.now() < cachedToken.expiresAt - 60000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: SERVICE_ACCOUNT.client_email, sub: SERVICE_ACCOUNT.client_email, aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/firebase.messaging", iat: now, exp: now + 3600 },
    SERVICE_ACCOUNT.private_key.replace(/\\n/g, "\n"),
    { algorithm: "RS256" }
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const payload = await response.json();
  if (!payload.access_token) throw new Error(payload.error_description || "fcm auth failed");
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function recipientTokens(userIds) {
  if (!userIds.length) return [];
  const params = [];
  const list = userIds.map((id) => {
    params.push(String(id));
    return `$${params.length}`;
  }).join(", ");
  const result = await pool.query(
    `SELECT DISTINCT i.device_token FROM installations i
      WHERE i.device_token IS NOT NULL AND i.device_token <> ''
        AND (i.user_id::text IN (${list}) OR (i.data ->> 'user') IN (${list}))`,
    params
  );
  return result.rows.map((row) => row.device_token);
}

async function send({ userIds, title, body, data = {}, avatar = null, image = null }) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  const tokens = await recipientTokens(ids);
  const log = async (sent, error) => {
    await pool.query(
      `INSERT INTO pushes (receiver_ids, title, body, data, sent, error)
       VALUES ($1::text[], $2, $3, $4::jsonb, $5, $6)`,
      [ids, title || null, body || null, JSON.stringify(data), sent, error || null]
    );
  };

  if (!SERVICE_ACCOUNT || !PROJECT_ID) {
    await log(false, "fcm not configured");
    return { delivered: false, recipients: tokens.length, reason: "FCM_SERVICE_ACCOUNT / FCM_PROJECT_ID not set" };
  }

  const token = await accessToken();
  const results = [];
  for (const deviceToken of tokens) {
    const message = {
      message: {
        token: deviceToken,
        notification: {
          title: title || "",
          body: body || "",
          ...(avatar ? { image: avatar } : {}),
        },
        data: Object.fromEntries(
          Object.entries({ ...data, avatar: avatar || "", big_picture: image || "" }).map(([key, value]) => [
            key,
            typeof value === "string" ? value : JSON.stringify(value),
          ])
        ),
      },
    };
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    results.push({ ok: response.ok, status: response.status });
  }

  const sentCount = results.filter((entry) => entry.ok).length;
  await log(sentCount > 0, sentCount === 0 ? "no recipient accepted" : null);
  return { delivered: sentCount > 0, recipients: sentCount, total: tokens.length };
}

module.exports = { send, configured: Boolean(SERVICE_ACCOUNT && PROJECT_ID) };
