const fetch = global.fetch;
const BASE = process.env.BASE_URL || "http://127.0.0.1:8090";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-access-token": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: response.status, json, text };
}

const suffix = Date.now().toString(36);
const W = (constraints) => `where=${encodeURIComponent(JSON.stringify({ suite: suffix, ...constraints }))}`;

async function main() {
  console.log(`parse semantics probe (suite ${suffix})`);

  const userA = await api("/api/auth/register", {
    method: "POST",
    body: { username: `a_${suffix}`, password: "secret123", email: `a_${suffix}@woz.local`, name: "Alpha" },
  });
  check("register returns sessionToken", userA.status === 201 && !!userA.json.sessionToken, userA.text);
  check("register flattens user fields", userA.json && userA.json.username === `a_${suffix}`);
  const tokenA = userA.json.sessionToken;
  const idA = userA.json.objectId;

  const userB = await api("/api/auth/register", {
    method: "POST",
    body: { username: `b_${suffix}`, password: "secret123", email: `b_${suffix}@woz.local` },
  });
  const tokenB = userB.json.sessionToken;
  const idB = userB.json.objectId;

  const posts = [];
  for (let index = 0; index < 5; index += 1) {
    const created = await api("/api/classes/Posts", {
      method: "POST",
      token: tokenA,
      body: {
        suite: suffix,
        title: `post ${index}`,
        caption: index % 2 === 0 ? "even caption" : "odd caption",
        likes: index,
        published: index > 1,
        owner: { __type: "Pointer", className: "_User", objectId: idA },
        tags: index === 0 ? ["hot", "new"] : ["cold"],
      },
    });
    posts.push(created.json);
  }
  check("posts created", posts.every((post) => post && post.objectId), JSON.stringify(posts[0] || {}));

  const eq = await api(`/api/classes/Posts?${W({ title: "post 2" })}`, { token: tokenA });
  check("whereEqualTo", eq.json.results.length === 1 && eq.json.results[0].title === "post 2", eq.text.slice(0, 200));

  const gt = await api(`/api/classes/Posts?${W({ likes: { $gt: 2 } })}&order=-likes&count=1`, { token: tokenA });
  check(
    "numeric $gt + order + count",
    gt.json.results && gt.json.results.length === 2 && gt.json.count === 2 && gt.json.results[0].likes === 4,
    gt.text.slice(0, 240)
  );

  const lt = await api(`/api/classes/Posts?${W({ likes: { $lt: 1 } })}`, { token: tokenA });
  check("numeric $lt", lt.json.results.length === 1 && lt.json.results[0].likes === 0, lt.text.slice(0, 160));

  const ne = await api(`/api/classes/Posts?${W({ published: { $ne: true } })}`, { token: tokenA });
  check("boolean $ne", ne.json.results.length === 2, ne.text.slice(0, 160));

  const exists = await api(`/api/classes/Posts?${W({ caption: { $exists: true } })}`, { token: tokenA });
  check("$exists", exists.json.results.length === 5, exists.text.slice(0, 160));

  const contains = await api(`/api/classes/Posts?${W({ caption: { $regex: "even", $options: "i" } })}`, { token: tokenA });
  check("contains via $regex", contains.json.results.length === 3, contains.text.slice(0, 160));

  const containedIn = await api(`/api/classes/Posts?${W({ title: { $in: ["post 0", "post 1"] } })}`, { token: tokenA });
  check("$in on strings", containedIn.json.results.length === 2, containedIn.text.slice(0, 160));

  const arrayIn = await api(`/api/classes/Posts?${W({ tags: { $in: ["hot"] } })}`, { token: tokenA });
  check("$in matches array element", arrayIn.json.results.length === 1, arrayIn.text.slice(0, 160));

  const notIn = await api(`/api/classes/Posts?${W({ tags: { $nin: ["hot"] } })}`, { token: tokenA });
  check("$nin excludes array match", notIn.json.results.length === 4, notIn.text.slice(0, 160));

  const all = await api(`/api/classes/Posts?${W({ tags: { $all: ["hot", "new"] } })}`, { token: tokenA });
  check("$all", all.json.results.length === 1, all.text.slice(0, 160));

  const orQuery = await api(`/api/classes/Posts?${W({ $or: [{ title: "post 0" }, { likes: { $gt: 3 } }] })}`, { token: tokenA });
  check("$or", orQuery.json.results.length === 2, orQuery.text.slice(0, 200));

  const pointerWhere = await api(
    `/api/classes/Posts?${W({ owner: { __type: "Pointer", className: "_User", objectId: idA } })}&limit=100`,
    { token: tokenA }
  );
  check("pointer equality", pointerWhere.json.results.length === 5, pointerWhere.text.slice(0, 160));

  const includeQuery = await api(`/api/classes/Posts?${W({ title: "post 0" })}&include=owner`, { token: tokenA });
  const included = includeQuery.json.results[0].owner;
  check("include resolves pointer", included && included.__type === "Object" && included.username === `a_${suffix}`, JSON.stringify(included));

  const selectSpec = { className: "Posts", where: { suite: suffix, likes: 4 }, key: "title" };
  const dont = await api(`/api/classes/Posts?${W({ title: { $dontSelect: selectSpec } })}&limit=100`, { token: tokenA });
  check(
    "$dontSelect excludes the sub-query key",
    dont.status === 200 && dont.json.results.length === 4,
    dont.text.slice(0, 200)
  );
  const does = await api(`/api/classes/Posts?${W({ title: { $select: selectSpec } })}&limit=100`, { token: tokenA });
  check(
    "$select matches the sub-query key",
    does.status === 200 && does.json.results.length === 1 && does.json.results[0].likes === 4,
    does.text.slice(0, 200)
  );

  const metaOrder = await api(`/api/classes/Posts?${W()}&order=-likes&limit=2`, { token: tokenA });
  check("order by json column", metaOrder.json.results.length === 2 && metaOrder.json.results[0].likes === 4, metaOrder.text.slice(0, 160));

  const badOp = await api(`/api/classes/Posts/${posts[0].objectId}`, {
    method: "PUT",
    token: tokenA,
    body: { likes: { __op: "Set", value: null } },
  });
  check("unsupported op is rejected", badOp.status === 400, badOp.text.slice(0, 160));

  const inc = await api(`/api/classes/Posts/${posts[0].objectId}`, {
    method: "PUT",
    token: tokenA,
    body: { likes: { __op: "Increment", amount: 3 }, tags: { __op: "AddUnique", objects: ["hot", "extra"] } },
  });
  check("update ops accepted", inc.status === 200, inc.text.slice(0, 160));
  const afterInc = await api(`/api/classes/Posts/${posts[0].objectId}`, { token: tokenA });
  check("Increment applied", afterInc.json.likes === 3, JSON.stringify(afterInc.json));
  check("AddUnique dedupes", JSON.stringify(afterInc.json.tags) === JSON.stringify(["hot", "new", "extra"]), JSON.stringify(afterInc.json.tags));

  const dec = await api(`/api/classes/Posts/${posts[0].objectId}`, {
    method: "PATCH",
    token: tokenA,
    body: { likes: { __op: "Decrement", amount: 1 } },
  });
  const afterDec = await api(`/api/classes/Posts/${posts[0].objectId}`, { token: tokenA });
  check("PATCH + Decrement", dec.status === 200 && afterDec.json.likes === 2, JSON.stringify(afterDec.json));

  await api(`/api/classes/Posts/${posts[0].objectId}`, {
    method: "PUT",
    token: tokenA,
    body: { tags: { __op: "RemoveAll", objects: ["new"] }, ghost: "x" },
  });
  const afterRemove = await api(`/api/classes/Posts/${posts[0].objectId}`, { token: tokenA });
  check("RemoveAll applied", !afterRemove.json.tags.includes("new"), JSON.stringify(afterRemove.json.tags));
  await api(`/api/classes/Posts/${posts[0].objectId}`, { method: "PUT", token: tokenA, body: { ghost: { __op: "Delete" } } });
  const afterDelete = await api(`/api/classes/Posts/${posts[0].objectId}`, { token: tokenA });
  check("Delete removes key", afterDelete.json.ghost === undefined, JSON.stringify(afterDelete.json).slice(0, 200));

  const userPatch = await api(`/api/classes/_User/${idB}`, {
    method: "PUT",
    token: tokenB,
    body: { diamonds: { __op: "Increment", amount: 250 }, following: { __op: "AddUnique", objects: [idA] } },
  });
  check("user ops accepted", userPatch.status === 200, userPatch.text.slice(0, 160));
  const userMe = await api("/api/auth/me", { token: tokenB });
  check("increment synced to typed column", userMe.json.diamonds === 250, JSON.stringify(userMe.json).slice(0, 240));
  check("addUnique stored", Array.isArray(userMe.json.following) && userMe.json.following[0] === idA, JSON.stringify(userMe.json.following));

  const foreignPatch = await api(`/api/classes/_User/${idA}`, { method: "PUT", token: tokenB, body: { diamonds: 99 } });
  check("cannot patch another user", foreignPatch.status === 403, foreignPatch.text.slice(0, 120));

  const userWhere = `where=${encodeURIComponent(JSON.stringify({ username: `b_${suffix}` }))}`;
  const userQuery = await api(`/api/classes/_User?${userWhere}&count=1`, { token: tokenA });
  check("_User queryable by username", userQuery.status === 200 && userQuery.json.results.length === 1, userQuery.text.slice(0, 200));
  if (userQuery.json.results && userQuery.json.results[0]) {
    check("_User hides password", userQuery.json.results[0].password === null, JSON.stringify(userQuery.json.results[0]).slice(0, 200));
  }

  const install = await api("/api/classes/_Installation", {
    method: "POST",
    token: tokenB,
    body: { installationId: `inst_${suffix}`, deviceToken: `tok_${suffix}`, appId: "woz" },
  });
  check("installation upsert", install.status === 201 && install.json.deviceToken === `tok_${suffix}`, install.text.slice(0, 200));
  const installAgain = await api(`/api/classes/_Installation/${install.json.objectId}`, {
    method: "PUT",
    token: tokenB,
    body: { installationId: `inst_${suffix}`, deviceToken: `tok2_${suffix}` },
  });
  check("installation update", installAgain.status === 200, installAgain.text.slice(0, 200));

  const follow = await api("/api/functions/follow_user", { method: "POST", token: tokenB, body: { authorId: idA, receiverId: idB } });
  check("follow_user", follow.status === 200 && Array.isArray(follow.json.result.following), follow.text.slice(0, 200));

  const unfollow = await api("/api/functions/unfollow_user", { method: "POST", token: tokenB, body: { authorId: idA, receiverId: idB } });
  check(
    "unfollow_user",
    unfollow.status === 200 && !unfollow.json.result.following.includes(idB),
    unfollow.text.slice(0, 200)
  );

  const gift = await api("/api/functions/send_gift", { method: "POST", token: tokenA, body: { objectId: idA, credits: 100 } });
  check("send_gift increments", gift.status === 200 && gift.json.result.diamonds === 100, gift.text.slice(0, 200));

  const updateGlobal = await api("/api/functions/update_user_global", {
    method: "POST",
    token: tokenA,
    body: { user: `a_${suffix}`, column: "profileCover", value: { __type: "File", name: "cover.jpg", url: "/uploads/cover.jpg" } },
  });
  check(
    "update_user_global by username",
    updateGlobal.status === 200 && updateGlobal.json.result.profileCover.url === "/uploads/cover.jpg",
    updateGlobal.text.slice(0, 220)
  );

  const picture = await api("/api/functions/change_picture", {
    method: "POST",
    token: tokenA,
    body: { user: idA, file: { __type: "Bytes", base64: Buffer.from("fake-jpeg-bytes").toString("base64") } },
  });
  check(
    "change_picture stores a file",
    picture.status === 200 && typeof picture.json.result.avatar.url === "string",
    picture.text.slice(0, 200)
  );

  const battle = await api("/api/classes/Streaming", {
    method: "POST",
    token: tokenA,
    body: { suite: suffix, streaming_channel: `live_${suffix}`, streaming: true, battle_status: "battle_alive", his_points: 9, my_points: 4 },
  });
  const restart = await api("/api/functions/restartPkBattle", {
    method: "POST",
    token: tokenA,
    body: { liveChannel: `live_${suffix}`, times: 2 },
  });
  check(
    "restartPkBattle zeroes points",
    restart.status === 200 && restart.json.result.his_points === 0 && restart.json.result.repeat_battle_times === 2,
    restart.text.slice(0, 240)
  );
  const savePoints = await api("/api/functions/save_hisBattle_points", {
    method: "POST",
    token: tokenA,
    body: { liveChannel: `live_${suffix}`, points: 77 },
  });
  check("save_hisBattle_points", savePoints.status === 200 && savePoints.json.result.his_points === 77, savePoints.text.slice(0, 200));

  const suspend = await api("/api/functions/suspend_user", { method: "POST", token: tokenA, body: { objectId: idB } });
  check("suspend requires admin", suspend.status === 400 && suspend.json.code === 119, suspend.text.slice(0, 160));

  const phone = await api("/api/functions/check_phone_number", { method: "POST", token: tokenA, body: { phone_number: "nope" } });
  check("check_phone_number", phone.status === 200 && phone.json.result.exists === false, phone.text.slice(0, 160));

  // Own phone verification replaces Firebase Auth's SMS role.
  const testPhone = `+1${String(Date.now()).slice(0, 10)}`;
  const badNumber = await api("/api/functions/request_phone_code", { method: "POST", body: { phone_number_full: "12345" } });
  check("request_phone_code validates number", badNumber.status === 400 && badNumber.json.code === 142, badNumber.text.slice(0, 160));

  const sent = await api("/api/functions/request_phone_code", { method: "POST", body: { phone_number_full: testPhone } });
  const sentResult = sent.json.result || {};
  check(
    "request_phone_code issues verification id",
    sent.status === 200 && /^[0-9a-f-]{36}$/.test(String(sentResult.verificationId)) && /^\d{6}$/.test(String(sentResult.codeWhenUnconfigured)),
    sent.text.slice(0, 200)
  );

  const again = await api("/api/functions/request_phone_code", { method: "POST", body: { phone_number_full: testPhone } });
  check("request_phone_code rate limits resend", again.status === 400 && again.json.code === 142, again.text.slice(0, 160));

  const wrongCode = await api("/api/functions/verify_phone_code", {
    method: "POST",
    body: { verification_id: sentResult.verificationId, code: "000000" },
  });
  check("verify_phone_code rejects wrong code", wrongCode.status === 400 && wrongCode.json.code === 125, wrongCode.text.slice(0, 160));

  const okCode = await api("/api/functions/verify_phone_code", {
    method: "POST",
    body: { verification_id: sentResult.verificationId, code: sentResult.codeWhenUnconfigured },
  });
  check(
    "verify_phone_code confirms number",
    okCode.status === 200 && okCode.json.result.verified === true && okCode.json.result.phoneNumberFull === testPhone && okCode.json.result.objectId === null,
    okCode.text.slice(0, 200)
  );

  const replay = await api("/api/functions/verify_phone_code", {
    method: "POST",
    body: { verification_id: sentResult.verificationId, code: sentResult.codeWhenUnconfigured },
  });
  check("verify_phone_code is single use", replay.status === 400 && replay.json.code === 142, replay.text.slice(0, 160));

  const anonGift = await api("/api/functions/send_gift", { method: "POST", body: { objectId: idA, credits: 10 } });
  check("non-public function still needs a session", anonGift.status === 401 && anonGift.json.code === 209, anonGift.text.slice(0, 160));

  const payment = await api("/api/functions/verify_payment", {
    method: "POST",
    token: tokenA,
    body: { packageName: "com.woz.audioparty", productId: "coins_100", purchaseToken: "abc" },
  });
  check(
    "verify_payment refuses to credit unconfigured",
    payment.status === 400 && payment.json.code === 141,
    payment.text.slice(0, 160)
  );

  const badFunction = await api("/api/functions/nope", { method: "POST", token: tokenA, body: {} });
  check("unknown function 400", badFunction.status === 400, badFunction.text.slice(0, 120));

  const config = await api("/api/config");
  check("config params", config.status === 200 && config.json.params.calls_enabled === true, config.text.slice(0, 200));

  const push = await api("/api/functions/sendPush", {
    method: "POST",
    token: tokenA,
    body: { receiverId: idB, senderId: idA, title: "hi", alert: "there", type: "chat", followers: [] },
  });
  check("sendPush is honest when FCM is unset", push.status === 200 && push.json.result.delivered === false, push.text.slice(0, 200));

  const noToken = await api(`/api/classes/Posts?${W()}`);
  check("class query requires a token", noToken.status === 401, noToken.text.slice(0, 120));

  const badSession = await api("/api/auth/me", { token: "not-a-real-token" });
  check(
    "invalid session reports Parse code 209",
    badSession.status === 401 && badSession.json.code === 209,
    badSession.text.slice(0, 160)
  );

  const deleted = await api(`/api/classes/Posts/${posts[4].objectId}`, { method: "DELETE", token: tokenA });
  check("delete", deleted.status === 200, deleted.text.slice(0, 120));
  const gone = await api(`/api/classes/Posts/${posts[4].objectId}`, { token: tokenA });
  check("deleted object is 404", gone.status === 404, gone.text.slice(0, 120));

  // Regex literals: the facade quotes user text with \Q...\E, POSIX has no such marker,
  // so the backend must translate it into escaped literals before matching.
  const rxSuite = `${suffix}_rx`;
  const RX = (constraints) =>
    `where=${encodeURIComponent(JSON.stringify({ suite: rxSuite, ...constraints }))}`;
  for (const title of ["dot.exp", "dotXexp", "plain"]) {
    await api("/api/classes/Posts", { method: "POST", token: tokenA, body: { suite: rxSuite, title } });
  }
  const quotedDot = await api(`/api/classes/Posts?${RX({ title: { $regex: "\\Qdot.exp\\E" } })}&limit=10`, { token: tokenA });
  check(
    "\\Q..\\E keeps the dot literal",
    quotedDot.json.results.length === 1 && quotedDot.json.results[0].title === "dot.exp",
    quotedDot.text.slice(0, 200)
  );
  const anchored = await api(`/api/classes/Posts?${RX({ title: { $regex: "^\\Qdot\\E$" } })}&limit=10`, { token: tokenA });
  check("full anchors respected", anchored.json.results.length === 0, anchored.text.slice(0, 200));
  const rawEscaped = await api(`/api/classes/Posts?${RX({ title: { $regex: "^dot\\.exp$" } })}&limit=10`, { token: tokenA });
  check("escaped raw regex matches once", rawEscaped.json.results.length === 1, rawEscaped.text.slice(0, 200));
  const rawAny = await api(`/api/classes/Posts?${RX({ title: { $regex: "^dot.exp$" } })}&limit=10`, { token: tokenA });
  check("unescaped dot matches any char", rawAny.json.results.length === 2, rawAny.text.slice(0, 200));

  // Parse sends $select/$dontSelect as { query: { className, where }, keys: [...] }.
  const nestedSpec = {
    query: { className: "Posts", where: { suite: rxSuite, title: "plain" } },
    keys: ["title"],
  };
  const nestedSelect = await api(
    `/api/classes/Posts?${RX({ title: { $select: nestedSpec } })}&limit=10`,
    { token: tokenA }
  );
  check(
    "Parse-shaped $select",
    nestedSelect.status === 200 && nestedSelect.json.results.length === 1 && nestedSelect.json.results[0].title === "plain",
    nestedSelect.text.slice(0, 220)
  );
  const nestedDont = await api(
    `/api/classes/Posts?${RX({ title: { $dontSelect: nestedSpec } })}&limit=10`,
    { token: tokenA }
  );
  check("Parse-shaped $dontSelect", nestedDont.status === 200 && nestedDont.json.results.length === 2, nestedDont.text.slice(0, 220));

  const inQuerySpec = { className: "Posts", where: { suite: rxSuite, title: "dotXexp" }, key: "title" };
  const inQuery = await api(
    `/api/classes/Posts?${RX({ title: { $inQuery: inQuerySpec } })}&limit=10`,
    { token: tokenA }
  );
  check(
    "$inQuery",
    inQuery.status === 200 && inQuery.json.results.length === 1 && inQuery.json.results[0].title === "dotXexp",
    inQuery.text.slice(0, 220)
  );
  const notInQuery = await api(
    `/api/classes/Posts?${RX({ title: { $notInQuery: inQuerySpec } })}&limit=10`,
    { token: tokenA }
  );
  check("$notInQuery", notInQuery.status === 200 && notInQuery.json.results.length === 2, notInQuery.text.slice(0, 220));

  // Live lists load keys first and fetch full objects on demand.
  const projected = await api(`/api/classes/Posts?${W({ title: "post 1" })}&keys=title,likes`, { token: tokenA });
  const one = projected.json.results[0] || {};
  check(
    "keys projection trims payload",
    projected.status === 200 && one.title === "post 1" && one.likes === 1 && one.caption === undefined && !!one.objectId && !!one.createdAt,
    JSON.stringify(one).slice(0, 220)
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
