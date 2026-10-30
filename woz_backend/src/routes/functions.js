const express = require("express");
const cloud = require("../cloud");
const { requireAuth, optionalAuth } = require("../auth");
const { asyncHandler } = require("../helpers");

const router = express.Router();

// Login/signup helpers run before a session exists; everything else stays authenticated.
const PUBLIC_FUNCTIONS = new Set(["check_phone_number", "request_phone_code", "verify_phone_code"]);

function gateAuth(req, res, next) {
  return PUBLIC_FUNCTIONS.has(req.params.name) ? optionalAuth(req, res, next) : requireAuth(req, res, next);
}

router.post(
  "/:name",
  gateAuth,
  asyncHandler(async (req, res) => {
    const context = { sub: req.auth.sub, role: req.auth.role, username: req.auth.username };
    try {
      const result = await cloud.run(req.params.name, req.body || {}, context);
      res.json({ result });
    } catch (error) {
      if (error instanceof cloud.CloudError) {
        return res.status(400).json({ code: error.code, error: error.message });
      }
      throw error;
    }
  })
);

module.exports = router;
