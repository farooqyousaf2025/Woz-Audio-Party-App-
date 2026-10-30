const { matchesWhere, applyIncludes, toMatchRow } = require("./include");

const subscriptions = new Map();
const byClass = new Map();
let nextId = 1;

function subscribe(client, { className, where, include }) {
  const id = `sub${nextId++}`;
  subscriptions.set(id, { id, client, className, where: where || {}, include });
  if (!byClass.has(className)) byClass.set(className, new Set());
  byClass.get(className).add(id);
  return id;
}

function unsubscribe(id) {
  const sub = subscriptions.get(id);
  if (!sub) return false;
  subscriptions.delete(id);
  const set = byClass.get(sub.className);
  if (set) {
    set.delete(id);
    if (!set.size) byClass.delete(sub.className);
  }
  return true;
}

function dropClient(client) {
  for (const [id, sub] of subscriptions) if (sub.client === client) unsubscribe(id);
}

function hasSubscribers(className) {
  const set = byClass.get(className);
  return Boolean(set && set.size);
}

function send(client, payload) {
  if (client.readyState === 1) client.send(JSON.stringify(payload));
}

// before / after are serialized objects (or null when the row did not exist yet / is gone).
async function emit(className, before, after) {
  const set = byClass.get(className);
  if (!set || set.size === 0) return;
  const subs = [...set].map((id) => subscriptions.get(id)).filter(Boolean);

  for (const sub of subs) {
    const afterHit = after ? await matchesWhere(sub.where, toMatchRow(after)) : false;
    const beforeHit = before ? await matchesWhere(sub.where, toMatchRow(before)) : false;

    let event = null;
    if (!before && after && afterHit) event = "create";
    else if (before && after && beforeHit && afterHit) event = "update";
    else if (before && after && !beforeHit && afterHit) event = "enter";
    else if (before && after && beforeHit && !afterHit) event = "leave";
    else if (before && !after && beforeHit) event = "delete";
    if (!event) continue;

    const object = after ? await expand(after, sub.include) : null;
    const original = before ? await expand(before, sub.include) : null;
    send(sub.client, {
      type: "live",
      action: event,
      subscriptionId: sub.id,
      className,
      // A delete has no "after" row, so the removed object travels as object.
      object: event === "delete" ? original : object,
      original,
    });
  }
}

async function expand(object, include) {
  const [expanded] = await applyIncludes([object], include);
  return expanded;
}

module.exports = { subscribe, unsubscribe, dropClient, hasSubscribers, emit };
