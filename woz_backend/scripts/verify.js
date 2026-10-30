require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });

const base = process.env.BASE_URL || "http://127.0.0.1:8090";
const results = [];
const check = (label, ok, detail) => results.push(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " :: " + detail : ""}`);

async function main() {
  // health
  const health = await (await fetch(`${base}/api/health`)).json();
  check("GET /api/health", health.status === "ok", JSON.stringify(health));

  // register + login + me
  const user = `probe${Date.now().toString().slice(-6)}`;
  const reg = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: "probe-pass-1", email: `${user}@woz.local`, name: "Probe User" }),
  });
  const regBody = await reg.json();
  check("POST /api/auth/register", reg.status === 201 && !!regBody.sessionToken, `status ${reg.status}`);

  const dup = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: "probe-pass-1" }),
  });
  check("duplicate username rejected", dup.status === 409, `status ${dup.status}`);

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: "probe-pass-1" }),
  });
  const { sessionToken: token } = await login.json();
  check("POST /api/auth/login", login.status === 200 && !!token, `status ${login.status}`);

  const badLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: "wrong-password" }),
  });
  check("bad password rejected", badLogin.status === 401, `status ${badLogin.status}`);

  const me = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meBody = await me.json();
  check("GET /api/auth/me", me.status === 200 && meBody.username === user, JSON.stringify(meBody.username));

  const anon = await fetch(`${base}/api/auth/me`);
  check("missing token rejected", anon.status === 401, `status ${anon.status}`);

  // class CRUD
  const created = await fetch(`${base}/api/classes/Posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "probe post", content: "hello", location: { lat: 1, lng: 2 } }),
  });
  const post = await created.json();
  check("POST /api/classes/Posts", created.status === 201 && !!post.objectId, JSON.stringify(post).slice(0, 120));

  const whereParam = encodeURIComponent(JSON.stringify({ title: "probe post" }));
  const list = await (await fetch(`${base}/api/classes/Posts?where=${whereParam}&limit=10`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check("GET list by where", list.results.length >= 1 && list.results[0].objectId === post.objectId, `total ${list.total}`);

  const counted = await (await fetch(`${base}/api/classes/Posts?where=${whereParam}&count=1`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check("GET count=1", counted.count === 1, `count ${counted.count}`);

  const patched = await fetch(`${base}/api/classes/Posts/${post.objectId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ likes: 3 }),
  });
  const patchBody = await patched.json();
  const refetched = await (await fetch(`${base}/api/classes/Posts/${post.objectId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check(
    "PATCH merge keeps old fields",
    patched.status === 200 && !!patchBody.updatedAt && refetched.likes === 3 && refetched.title === "probe post",
    JSON.stringify(refetched).slice(0, 140)
  );

  const other = await fetch(`${base}/api/classes/Posts/${post.objectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer not-a-token" },
  });
  check("PATCH without auth rejected", other.status === 401, `status ${other.status}`);

  const unknown = await fetch(`${base}/api/classes/NoSuchClass`, { headers: { Authorization: `Bearer ${token}` } });
  check("unknown class 404", unknown.status === 404, `status ${unknown.status}`);

  const userClass = await fetch(`${base}/api/classes/_User?limit=5`, { headers: { Authorization: `Bearer ${token}` } });
  const userClassBody = await userClass.json();
  check(
    "_User is readable but never leaks the hash",
    userClass.status === 200 && Array.isArray(userClassBody.results) && userClassBody.results.every((row) => !row.password_hash),
    `status ${userClass.status}`
  );

  const del = await fetch(`${base}/api/classes/Posts/${post.objectId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  check("DELETE own object", del.status === 200, `status ${del.status}`);
  const gone = await fetch(`${base}/api/classes/Posts/${post.objectId}`, { headers: { Authorization: `Bearer ${token}` } });
  check("deleted object gone", gone.status === 404, `status ${gone.status}`);

  // files
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "probe.png");
  const up = await fetch(`${base}/api/files`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const upBody = await up.json();
  check("POST /api/files upload", up.status === 201 && /^\/uploads\//.test(upBody.url || ""), JSON.stringify(upBody));

  if (upBody.url) {
    const dl = await fetch(`${base}${upBody.url}`);
    const bytes = Buffer.from(await dl.arrayBuffer());
    check("GET uploaded file", dl.status === 200 && bytes.length === png.length, `${dl.status} ${bytes.length} bytes`);
  }

  const htmlForm = new FormData();
  htmlForm.append("file", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "probe.html");
  const blocked = await fetch(`${base}/api/files`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: htmlForm });
  const blockedBody = await blocked.text();
  check("html upload rejected", blocked.status === 400, `${blocked.status} ${blockedBody.slice(0, 80)}`);

  const noAuth = new FormData();
  noAuth.append("file", new Blob([png], { type: "image/png" }), "x.png");
  const denied = await fetch(`${base}/api/files`, { method: "POST", body: noAuth });
  check("upload requires auth", denied.status === 401, `status ${denied.status}`);

  // admin pages
  const adminLogin = await fetch(`${base}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: process.env.ADMIN_USERNAME || "admin", password: String(process.env.ADMIN_PASSWORD) }),
    redirect: "manual",
  });
  const cookies = (adminLogin.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  check("POST /admin/login", adminLogin.status === 302 && /woz_admin=/.test(cookies), `status ${adminLogin.status}`);

  for (const path of ["/admin", "/admin/users", "/admin/models"]) {
    const res = await fetch(`${base}${path}`, { headers: { Cookie: cookies } });
    const html = await res.text();
    check(`GET ${path}`, res.status === 200 && html.includes("Woz Audio Party App"), `status ${res.status}, ${html.length} bytes`);
  }

  const badAdmin = await fetch(`${base}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password: "nope" }),
    redirect: "manual",
  });
  check("bad admin password redirected", badAdmin.status === 302 && badAdmin.headers.get("location") === "/admin/login?error=invalid", `location ${badAdmin.headers.get("location")}`);

  const noCookie = await fetch(`${base}/admin/users`, { redirect: "manual" });
  check("admin page requires session", noCookie.status === 302 && noCookie.headers.get("location") === "/admin/login", `location ${noCookie.headers.get("location")}`);

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
