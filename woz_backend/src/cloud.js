const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pool = require("./db");
const store = require("./store");
const push = require("./push");
const { encodeValue } = require("./parse");

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class CloudError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireParams(params, names) {
  for (const name of names) {
    if (params[name] === undefined || params[name] === null || params[name] === "") {
      throw new CloudError(142, `${name} is required`);
    }
  }
}

async function resolveUser(ref) {
  const value = String(ref);
  const byId = UUID.test(value) ? await store.get("_User", value) : null;
  if (byId) return byId;
  const { results } = await store.list("_User", { where: { username: value }, limit: 1 });
  if (results[0]) return results[0];
  throw new CloudError(101, "user not found");
}

function decodeBytes(value) {
  if (typeof value === "string") return Buffer.from(value, "base64");
  if (value && typeof value === "object" && value.__type === "Bytes" && typeof value.base64 === "string") {
    return Buffer.from(value.base64, "base64");
  }
  throw new CloudError(1305, "expected bytes payload");
}

function saveBytes(buffer, prefix, extension) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extension}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return { name: filename, url: `/uploads/${filename}` };
}

async function bumpDiamonds(userId, credits, keys) {
  const amount = Number(credits);
  if (!Number.isFinite(amount) || amount <= 0) throw new CloudError(142, "credits must be a positive number");
  const body = {};
  for (const key of keys) body[key] = { __op: "Increment", amount };
  return store.update("_User", userId, body);
}

async function findStreaming(liveChannel) {
  const object = await store.first("Streaming", {
    where: { streaming_channel: liveChannel, streaming: true, battle_status: "battle_alive" },
  });
  if (!object) throw new CloudError(101, "no active battle on that channel");
  return object;
}

const functions = {
  async update_user_global(params) {
    requireParams(params, ["user", "column"]);
    const user = await resolveUser(params.user);
    return store.update("_User", user.objectId, { [params.column]: encodeValue(params.value) });
  },

  async update_user_global_list(params) {
    const { user: ref, ...fields } = params;
    requireParams(params, ["user"]);
    const user = await resolveUser(ref);
    const body = {};
    for (const [column, value] of Object.entries(fields)) {
      if (["objectId", "createdAt", "updatedAt", "__type"].includes(column)) continue;
      body[column] = encodeValue(value);
    }
    return store.update("_User", user.objectId, body);
  },

  async follow_user(params, ctx) {
    requireParams(params, ["authorId", "receiverId"]);
    if (params.authorId === params.receiverId) throw new CloudError(142, "cannot follow yourself");
    await resolveUser(params.authorId);
    await resolveUser(params.receiverId);
    await store.update("_User", params.receiverId, { followers: { __op: "AddUnique", objects: [ctx.pointer] } });
    return store.update("_User", params.authorId, { following: { __op: "AddUnique", objects: [params.receiverId] } });
  },

  async unfollow_user(params, ctx) {
    requireParams(params, ["authorId", "receiverId"]);
    await store.update("_User", params.receiverId, { followers: { __op: "RemoveAll", objects: [ctx.pointer] } });
    return store.update("_User", params.authorId, { following: { __op: "RemoveAll", objects: [params.receiverId] } });
  },

  async send_gift(params) {
    requireParams(params, ["objectId", "credits"]);
    const user = await resolveUser(params.objectId);
    return bumpDiamonds(user.objectId, params.credits, ["diamonds", "diamondsTotal"]);
  },

  async send_agency(params) {
    requireParams(params, ["objectId", "credits"]);
    const user = await resolveUser(params.objectId);
    return bumpDiamonds(user.objectId, params.credits, ["diamondsAgency", "diamondsAgencyTotal"]);
  },

  async restartPkBattle(params) {
    requireParams(params, ["liveChannel"]);
    const streaming = await findStreaming(params.liveChannel);
    return store.update("Streaming", streaming.objectId, {
      his_points: 0,
      my_points: 0,
      repeat_battle_times: Number(params.times || 0),
    });
  },

  async save_hisBattle_points(params) {
    requireParams(params, ["liveChannel", "points"]);
    const streaming = await findStreaming(params.liveChannel);
    return store.update("Streaming", streaming.objectId, { his_points: Number(params.points) });
  },

  async suspend_user(params, ctx) {
    requireParams(params, ["objectId"]);
    if (ctx.role !== "admin") throw new CloudError(119, "only an administrator can suspend a user");
    const user = await resolveUser(params.objectId);
    return store.update("_User", user.objectId, { activationStatus: true });
  },

  async check_phone_number(params) {
    const phone = String(params.phone_number_full || params.phone_number || "");
    if (!phone) throw new CloudError(142, "phone_number is required");
    const { results } = await store.list("_User", { where: { phoneNumberFull: phone }, limit: 1 });
    return { exists: results.length > 0, objectId: results[0] ? results[0].objectId : null };
  },

  // Own SMS verification: the code is kept server side and echoed back until an SMS
  // provider is configured, so the app flow stays testable without one.
  async request_phone_code(params) {
    requireParams(params, ["phone_number_full"]);
    const phone = String(params.phone_number_full).replace(/[^\d+]/g, "");
    if (!/^\+?\d{8,15}$/.test(phone)) throw new CloudError(142, "phone_number_full is not a valid number");

    const recent = await pool.query(
      `SELECT 1 FROM activity_logs WHERE action = 'phone_verification' AND detail ->> 'phone' = $1
        AND created_at > now() - interval '60 seconds' LIMIT 1`,
      [phone]
    );
    if (recent.rowCount) throw new CloudError(142, "a code was already sent, try again in a minute");

    const code = String(crypto.randomInt(100000, 999999));
    const verificationId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, detail) VALUES (NULL, 'phone_verification', $1::jsonb)`,
      [JSON.stringify({ verificationId, phone, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() })]
    );
    return {
      verificationId,
      expiresIn: 300,
      codeWhenUnconfigured: process.env.SMS_PROVIDER ? undefined : code,
    };
  },

  async verify_phone_code(params) {
    requireParams(params, ["verification_id", "code"]);
    const { rows } = await pool.query(
      `SELECT id, detail FROM activity_logs WHERE action = 'phone_verification' AND detail ->> 'verificationId' = $1
        ORDER BY created_at DESC LIMIT 1`,
      [String(params.verification_id)]
    );
    if (!rows.length) throw new CloudError(142, "verification request not found");
    const pending = rows[0].detail;
    if (pending.usedAt) throw new CloudError(142, "verification code already used");
    if (new Date(pending.expiresAt).getTime() < Date.now()) throw new CloudError(142, "verification code expired");
    if (String(pending.code) !== String(params.code)) throw new CloudError(125, "sms code is invalid");

    await pool.query(`UPDATE activity_logs SET detail = detail || jsonb_build_object('usedAt', now()) WHERE id = $1`, [
      rows[0].id,
    ]);
    const existing = await store.first("_User", { where: { phoneNumberFull: pending.phone } });
    return { verified: true, phoneNumberFull: pending.phone, objectId: existing ? existing.objectId : null };
  },

  async add_to_my_fan_club(params, ctx) {
    requireParams(params, ["fan_club_owner_id", "fan_id"]);
    const existing = await store.first("FanClubMembers", {
      where: { fanClubOwnerId: params.fan_club_owner_id, fanId: params.fan_id },
    });
    if (existing) return existing;
    return store.create("FanClubMembers", {
      fanClubOwnerId: params.fan_club_owner_id,
      fanId: params.fan_id,
      joinedAt: new Date().toISOString(),
    }, { sub: ctx.sub });
  },

  async change_picture(params) {
    requireParams(params, ["file", "user"]);
    const bytes = decodeBytes(params.file);
    if (bytes.length > 8 * 1024 * 1024) throw new CloudError(142, "image is too large");
    const saved = saveBytes(bytes, "avatar", ".jpg");
    const user = await resolveUser(params.user);
    return store.update("_User", user.objectId, { avatar: { __type: "File", name: saved.name, url: saved.url } });
  },

  async upload_video(params) {
    requireParams(params, ["image"]);
    const bytes = decodeBytes(params.image);
    if (bytes.length > 20 * 1024 * 1024) throw new CloudError(142, "video is too large");
    const saved = saveBytes(bytes, "video", ".mp4");
    return {
      name: saved.name,
      url: saved.url,
      __type: "File",
      // Transcoding/thumbnails need ffmpeg; the raw upload is stored as-is.
      processed: false,
    };
  },

  async send_my_email(params) {
    requireParams(params, ["user", "email_type"]);
    const user = await resolveUser(params.user);
    const code = String(crypto.randomInt(100000, 999999));
    await store.update("_User", user.objectId, {
      emailVerification: { code, sentAt: new Date().toISOString(), type: params.email_type },
    });
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, detail) VALUES ($1, 'email_verification', $2::jsonb)`,
      [user.objectId, JSON.stringify({ email: user.email, type: params.email_type })]
    );
    return { sent: Boolean(process.env.SMTP_HOST), codeWhenUnconfigured: process.env.SMTP_HOST ? undefined : code };
  },

  async verify_my_email(params) {
    requireParams(params, ["user", "email_verification_code"]);
    const user = await resolveUser(params.user);
    const pending = user.emailVerification;
    if (!pending || pending.code !== String(params.email_verification_code)) {
      throw new CloudError(138, "verification code does not match");
    }
    const updated = await store.update("_User", user.objectId, { emailVerified: true });
    return { verified: true, user: updated };
  },

  async verify_payment(params, ctx) {
    requireParams(params, ["packageName", "productId", "purchaseToken"]);
    const user = await resolveUser(ctx.sub);
    const receipt = {
      userId: user.objectId,
      packageName: params.packageName,
      productId: params.productId,
      platform: params.platform || "android",
      purchaseToken: params.purchaseToken,
    };
    if (!process.env.PLAY_SERVICE_ACCOUNT) {
      await pool.query(`INSERT INTO activity_logs (user_id, action, detail) VALUES ($1, 'purchase_pending', $2::jsonb)`, [
        user.objectId,
        JSON.stringify(receipt),
      ]);
      throw new CloudError(141, "payment verification is not configured on this server");
    }
    const verified = await verifyGooglePurchase(params.packageName, params.productId, params.purchaseToken);
    if (!verified) throw new CloudError(142, "purchase could not be verified");
    await pool.query(`INSERT INTO activity_logs (user_id, action, detail) VALUES ($1, 'purchase_verified', $2::jsonb)`, [
      user.objectId,
      JSON.stringify({ ...receipt, state: verified.purchaseState }),
    ]);
    return { verified: true, state: verified.purchaseState };
  },

  async sendPush(params) {
    const receivers = params.type === "live" ? (params.followers || []).filter(Boolean) : [params.receiverId].filter(Boolean);
    if (!receivers.length) return { delivered: false, recipients: 0 };
    return push.send({
      userIds: receivers,
      title: params.title,
      body: params.alert,
      avatar: params.avatar || params.large_icon,
      image: params.big_picture,
      data: {
        view: params.view,
        alert: params.alert,
        senderId: params.senderId,
        senderName: params.senderName,
        type: params.type,
        chat: params.chat,
        objectId: params.objectId,
      },
    });
  },

  async updatePassword(params) {
    requireParams(params, ["username", "password"]);
    if (params.password.length < 6) throw new CloudError(142, "password must be at least 6 characters");
    const user = await resolveUser(params.username);
    await store.update("_User", user.objectId, { password: params.password, secondaryPassword: params.password });
    return "updated";
  },
};

async function verifyGooglePurchase(packageName, productId, purchaseToken) {
  const assertion = require("jsonwebtoken");
  const account = JSON.parse(fs.readFileSync(path.resolve(process.env.PLAY_SERVICE_ACCOUNT), "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const signed = assertion.sign(
    { iss: account.client_email, sub: account.client_email, aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/androidpublisher", iat: now, exp: now + 3600 },
    account.private_key.replace(/\\n/g, "\n"),
    { algorithm: "RS256" }
  );
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signed }),
  });
  const token = await tokenResponse.json();
  if (!token.access_token) return null;
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}` +
    `/purchases/products/${productId}/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!response.ok) return null;
  return response.json();
}

async function run(name, params = {}, ctx = {}) {
  const handler = functions[name];
  if (!handler) throw new CloudError(100, `unknown cloud function ${name}`);
  return handler(params, { ...ctx, pointer: { __type: "Pointer", className: "_User", objectId: ctx.sub } });
}

module.exports = { run, functions, CloudError };
