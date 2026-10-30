const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET;

function signToken(user) {
  return jwt.sign(
    { sub: user.object_id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: "7d" }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function readToken(req) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return req.get("x-access-token") || req.query.token;
}

function requireAuth(req, res, next) {
  const payload = verifyToken(readToken(req));
  if (!payload) {
    return res.status(401).json({ code: 209, error: "invalid session token" });
  }
  req.auth = payload;
  next();
}

function optionalAuth(req, res, next) {
  req.auth = verifyToken(readToken(req)) || { sub: null, username: null, role: "anonymous" };
  next();
}

function requireAdmin(req, res, next) {
  if (!req.auth || req.auth.role !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

module.exports = { signToken, verifyToken, readToken, requireAuth, optionalAuth, requireAdmin };
