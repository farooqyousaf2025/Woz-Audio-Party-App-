const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { requireAuth } = require("../auth");

const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, uploadDir),
  filename: (req, file, callback) => {
    const ext = path.extname(file.originalname || "").slice(0, 12);
    callback(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif",
  ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".amr",
  ".mp4", ".mov", ".webm", ".avi", ".mkv", ".3gp", ".m4v",
  ".pdf", ".json", ".txt",
]);

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return callback(new Error(`unsupported file type: ${ext || "none"}`));
    }
    callback(null, true);
  },
});
const router = express.Router();

router.post("/", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
  });
});

router.use((error, req, res, next) => {
  res.status(400).json({ error: error.message || "upload failed" });
});

module.exports = router;
