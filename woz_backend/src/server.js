require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const pool = require("./db");
const authRoutes = require("./routes/auth");
const objectRoutes = require("./routes/objects");
const fileRoutes = require("./routes/files");
const functionRoutes = require("./routes/functions");
const configRoutes = require("./routes/config");
const adminRoutes = require("./admin");
const { attachWebSocket } = require("./ws");

const app = express();
const port = Number(process.env.PORT || 8090);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "admin", "views"));

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
app.use("/uploads", express.static(uploadDir));

const publicDir = path.join(__dirname, "..", "admin", "public");
app.use("/admin/assets", express.static(path.join(publicDir, "assets")));
app.use("/admin/vendor", express.static(path.join(publicDir, "vendor")));
app.use("/admin/media", express.static(path.join(publicDir, "media")));

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "woz-backend" });
  } catch (error) {
    res.status(500).json({ status: "error", error: error.message });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/classes", objectRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/functions", functionRoutes);
app.use("/api/config", configRoutes);
app.use("/admin", adminRoutes);

app.get("/", (req, res) => res.redirect("/admin"));

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "not found" });
  }
  res.status(404).render("error", { appName: "Woz Audio Party App", admin: null, message: "Page not found" });
});

app.use((error, req, res, next) => {
  const status = error.status || error.statusCode || 500;
  if (status >= 500) console.error(error);
  if (req.path.startsWith("/api")) {
    return res.status(status).json({ code: error.code || status, error: error.message || "server error" });
  }
  res.status(status).render("error", {
    appName: "Woz Audio Party App",
    admin: req.admin || null,
    message: error.message || "Server error",
  });
});

const server = http.createServer(app);
attachWebSocket(server);

server.listen(port, "0.0.0.0", () => {
  console.log(`Woz backend listening on http://0.0.0.0:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
