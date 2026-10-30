require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });

const base = process.env.BASE_URL || "http://127.0.0.1:8090";
const adminPassword = process.env.ADMIN_PASSWORD;
const results = [];

function check(label, ok, detail) {
  results.push(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " :: " + detail : ""}`);
}

async function main() {
  // file upload — provision a throwaway account so the run has no leftover state
  const user = `admin_probe_${Date.now().toString(36)}`;
  const signUp = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: "secret123" }),
  });
  check("POST /api/auth/register", signUp.status === 201, `status ${signUp.status}`);

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: "secret123" }),
  });
  const { sessionToken: token } = await login.json();
  check("login", login.status === 200 && !!token, `status ${login.status}`);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "tiny.png");
  const up = await fetch(`${base}/api/files`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const uploaded = await up.json();
  check("upload png", up.status === 201 && String(uploaded.url).startsWith("/uploads/"), JSON.stringify(uploaded));

  const dl = await fetch(`${base}${uploaded.url || "/uploads/missing"}`);
  const bytes = Buffer.from(await dl.arrayBuffer());
  check("download uploaded file", dl.status === 200 && bytes.length === png.length, `${dl.status} ${bytes.length}B`);

  const badForm = new FormData();
  badForm.append("file", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "evil.html");
  const bad = await fetch(`${base}/api/files`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: badForm });
  const badBody = await bad.text();
  check("reject html upload", bad.status === 400, `${bad.status} ${badBody.slice(0, 60)}`);

  // admin pages with cookie jar
  const loginPage = await fetch(`${base}/admin/login`);
  const loginHtml = await loginPage.text();
  check("GET /admin/login renders", loginPage.status === 200 && /Welcome to Woz Audio Party App/.test(loginHtml), `status ${loginPage.status}`);

  const formBody = new URLSearchParams({ username: "admin", password: adminPassword });
  const asPost = await fetch(`${base}/admin/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody, redirect: "manual" });
  const cookie = (asPost.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  check("POST /admin/login sets cookie", asPost.status === 302 && /woz_admin=/.test(cookie), `status ${asPost.status}`);

  for (const path of ["/admin", "/admin/users", "/admin/models"]) {
    const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
    const html = await res.text();
    check(`GET ${path}`, res.status === 200 && html.includes("main-wrapper"), `${res.status} ${html.length}B`);
  }

  const usersHtml = await (await fetch(`${base}/admin/users`, { headers: { Cookie: cookie } })).text();
  const idMatch = usersHtml.match(/\/admin\/users\/([0-9a-f-]{36})/);
  check("users list shows admin row", /admin/.test(usersHtml) && !!idMatch, idMatch ? idMatch[1] : "no edit link");

  if (idMatch) {
    const edit = await fetch(`${base}/admin/users/${idMatch[1]}`, { headers: { Cookie: cookie } });
    const editHtml = await edit.text();
    check("GET user edit", edit.status === 200 && /Profile data/.test(editHtml), `${edit.status}`);

    const save = await fetch(`${base}/admin/users/${idMatch[1]}`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Super Admin", email: "admin@woz.local", role: "admin", credit: "100", diamonds: "5", diamonds_total: "5", p_coins: "0" }),
      redirect: "manual",
    });
    check("POST user edit saves", save.status === 302, `${save.status}`);
    const after = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: adminPassword }) })).json();
    check("saved fields readable via API", after.name === "Super Admin" && after.credit === 100, JSON.stringify({ name: after.name, credit: after.credit }));
  }

  const anon = await fetch(`${base}/admin/users`, { redirect: "manual" });
  check("anonymous redirected to login", anon.status === 302 && anon.headers.get("location") === "/admin/login", `${anon.status} ${anon.headers.get("location")}`);

  const missing = await fetch(`${base}/admin/nope`, { headers: { Cookie: cookie } });
  const missingHtml = await missing.text();
  check("404 page renders", missing.status === 404 && /Page not found/.test(missingHtml), `${missing.status}`);

  const asset = await fetch(`${base}/admin/assets/dashboard/css/style.css`);
  check("dashboard css asset served", asset.status === 200, `${asset.status}`);
  const logo = await fetch(`${base}/admin/media/logo.png`);
  check("logo asset served", logo.status === 200, `${logo.status} ${logo.headers.get("content-type")}`);

  // websocket
  const { WebSocket } = require("ws");
  await new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`);
    const got = {};
    const timer = setTimeout(() => { finish(); }, 8000);
    function finish() {
      clearTimeout(timer);
      ws.close();
      check("websocket subscribe+broadcast", !!got.sub && !!got.msg, JSON.stringify(got));
      resolve();
    }
    ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", channel: "room:test" })));
    ws.on("message", (raw) => {
      const data = JSON.parse(raw.toString());
      if (data.type === "subscribed") {
        got.sub = data.channel;
        const peer = new WebSocket(`${base.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`);
        peer.on("open", () => peer.send(JSON.stringify({ type: "publish", channel: "room:test", data: { hello: "world" } })));
      }
      if (data.type === "message") got.msg = data.data;
      if (data.type === "published") got.ack = data.receivers;
    });
    ws.on("error", (e) => { got.error = e.message; finish(); });
  });

  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
