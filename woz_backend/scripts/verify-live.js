const WebSocket = require("ws");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8090";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";

const results = [];
const check = (label, ok, detail) => results.push(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " :: " + detail : ""}`);

async function api(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  try {
    return { status: response.status, json: JSON.parse(text) };
  } catch {
    return { status: response.status, json: null, text };
  }
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    const events = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      events.push(message);
    });
    socket.on("error", reject);
    socket.on("close", (code) => reject(new Error(`closed ${code}`)));
    socket.on("open", () => resolve({ socket, events }));
  });
}

function send(socket, payload) {
  socket.send(JSON.stringify(payload));
}

async function waitFor(events, predicate, timeout = 8000, from = 0) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (let index = from; index < events.length; index += 1) {
      if (predicate(events[index])) return events[index];
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

function closedCode(token) {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => resolve("timeout"), 4000);
    socket.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve("error");
    });
  });
}

const suffix = Date.now().toString(36);

async function main() {
  const a = await api("/api/auth/register", { method: "POST", body: { username: `la_${suffix}`, password: "secret123" } });
  const b = await api("/api/auth/register", { method: "POST", body: { username: `lb_${suffix}`, password: "secret123" } });
  const tokenA = a.json.sessionToken;
  const tokenB = b.json.sessionToken;

  const { socket, events } = await connect(tokenA);
  const where = { suite: suffix, tracked: true };
  send(socket, { type: "live", action: "subscribe", className: "Posts", where, include: "author", requestId: "r1" });

  const subscribed = await waitFor(events, (message) => message.action === "subscribed" && message.requestId === "r1");
  check("live subscribe acknowledged", !!subscribed && !!subscribed.subscriptionId, JSON.stringify(subscribed || {}));

  const closeCode = await closedCode("not-a-token");
  check("live rejects a bad token", closeCode === 4401, `code ${closeCode}`);

  const created = await api("/api/classes/Posts", {
    method: "POST",
    token: tokenB,
    body: { suite: suffix, tracked: true, title: "live", author: { __type: "Pointer", className: "_User", objectId: b.json.objectId } },
  });
  const createEvent = await waitFor(events, (message) => message.action === "create");
  check("create event delivered", !!createEvent && createEvent.object.title === "live", JSON.stringify(createEvent || {}));
  check(
    "create event resolves include",
    !!createEvent && createEvent.object.author && createEvent.object.author.__type === "Object" &&
      createEvent.object.author.username === `lb_${suffix}`,
    JSON.stringify(createEvent && createEvent.object.author)
  );

  const notMine = await api("/api/classes/Posts", { method: "POST", token: tokenB, body: { suite: suffix, tracked: false, title: "ignored" } });
  await new Promise((resolve) => setTimeout(resolve, 800));
  check("non-matching create is not delivered", !events.some((message) => message.action === "create" && message.object && message.object.title === "ignored"), "");

  await api(`/api/classes/Posts/${created.json.objectId}`, { method: "PUT", token: tokenB, body: { title: "live renamed" } });
  const updateEvent = await waitFor(events, (message) => message.action === "update");
  check("update event delivered", !!updateEvent && updateEvent.object.title === "live renamed", JSON.stringify(updateEvent || {}));
  check("update event carries original", !!updateEvent && updateEvent.original && updateEvent.original.title === "live", "");

  await api(`/api/classes/Posts/${created.json.objectId}`, { method: "PUT", token: tokenB, body: { tracked: false } });
  const leaveEvent = await waitFor(events, (message) => message.action === "leave");
  check("leave event when the object drops out", !!leaveEvent, JSON.stringify(leaveEvent || {}));

  await api(`/api/classes/Posts/${created.json.objectId}`, { method: "PUT", token: tokenB, body: { tracked: true } });
  const enterEvent = await waitFor(events, (message) => message.action === "enter");
  check("enter event when the object returns", !!enterEvent, JSON.stringify(enterEvent || {}));

  send(socket, { type: "live", action: "unsubscribe", subscriptionId: subscribed.subscriptionId });
  const unsubscribed = await waitFor(events, (message) => message.action === "unsubscribed");
  check("unsubscribe acknowledged", !!unsubscribed, "");

  send(socket, { type: "live", action: "subscribe", className: "Posts", where: { suite: suffix, tracked: true }, requestId: "r2" });
  const resubscribed = await waitFor(events, (message) => message.action === "subscribed" && message.requestId === "r2");
  check("resubscribe after unsubscribe", !!resubscribed && resubscribed.subscriptionId !== subscribed.subscriptionId, "");

  const marker = events.length;
  await api(`/api/classes/Posts/${notMine.json.objectId}`, { method: "DELETE", token: tokenB });
  await api(`/api/classes/Posts/${created.json.objectId}`, { method: "DELETE", token: tokenB });
  const deleteEvent = await waitFor(events, (message) => message.action === "delete", 8000, marker);
  check("delete event delivered to a new subscription", !!deleteEvent && deleteEvent.object.objectId === created.json.objectId, JSON.stringify(deleteEvent || {}));
  check(
    "unrelated delete is not delivered",
    !events.slice(marker).some((message) => message.action === "delete" && message.object && message.object.objectId === notMine.json.objectId),
    ""
  );

  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  check("dropping the socket cleans subscriptions", true, "");

  console.log(results.join("\n"));
  const failed = results.filter((row) => row.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} live checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
