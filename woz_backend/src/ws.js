const { WebSocketServer } = require("ws");
const { verifyToken } = require("./auth");
const livequery = require("./livequery");
const { objectSource } = require("./classes");

function handleLive(ws, message) {
  const reply = (payload) => ws.send(JSON.stringify({ type: "live", ...payload }));

  if (message.action === "subscribe") {
    const source = objectSource(message.className);
    if (!source) return reply({ action: "error", error: "unknown class", requestId: message.requestId });
    let where = message.where || {};
    if (typeof where === "string") {
      try {
        where = JSON.parse(where);
      } catch {
        return reply({ action: "error", error: "invalid where", requestId: message.requestId });
      }
    }
    const subscriptionId = livequery.subscribe(ws, {
      className: message.className,
      where,
      include: message.include,
    });
    return reply({ action: "subscribed", subscriptionId, requestId: message.requestId, className: message.className });
  }

  if (message.action === "unsubscribe") {
    livequery.unsubscribe(message.subscriptionId);
    return reply({ action: "unsubscribed", subscriptionId: message.subscriptionId });
  }
  return reply({ action: "error", error: `unknown live action ${message.action}` });
}

const channels = new Map();

function join(ws, channel) {
  if (!channel || typeof channel !== "string") return;
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(ws);
  ws.channels = ws.channels || new Set();
  ws.channels.add(channel);
}

function leave(ws, channel) {
  const set = channels.get(channel);
  if (set) {
    set.delete(ws);
    if (set.size === 0) channels.delete(channel);
  }
  if (ws.channels) ws.channels.delete(channel);
}

function broadcast(channel, payload) {
  const set = channels.get(channel);
  if (!set) return 0;
  const message = JSON.stringify(payload);
  for (const client of set) {
    if (client.readyState === client.OPEN) client.send(message);
  }
  return set.size;
}

function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const payload = verifyToken(url.searchParams.get("token"));
    if (!payload) {
      ws.close(4401, "unauthorized");
      return;
    }

    ws.userId = payload.sub;
    ws.channels = new Set();
    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "invalid json" }));
        return;
      }

      if (message.type === "subscribe") {
        join(ws, message.channel);
        ws.send(JSON.stringify({ type: "subscribed", channel: message.channel }));
      } else if (message.type === "unsubscribe") {
        leave(ws, message.channel);
        ws.send(JSON.stringify({ type: "unsubscribed", channel: message.channel }));
      } else if (message.type === "live") {
        handleLive(ws, message);
      } else if (message.type === "publish") {
        const receivers = broadcast(message.channel, {
          type: "message",
          channel: message.channel,
          from: ws.userId,
          data: message.data,
        });
        ws.send(JSON.stringify({ type: "published", channel: message.channel, receivers }));
      } else if (message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });

    ws.on("close", () => {
      livequery.dropClient(ws);
      for (const channel of ws.channels) leave(ws, channel);
    });

    ws.send(JSON.stringify({ type: "connected", userId: ws.userId }));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on("close", () => clearInterval(heartbeat));
  return wss;
}

module.exports = { attachWebSocket, broadcast };
