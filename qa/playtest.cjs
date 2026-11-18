// From the repository root, with playwright-core resolvable:
// node qa/playtest.cjs http://127.0.0.1:18746
const { chromium } = require("playwright-core");
const { strict: assert } = require("node:assert");
const fs = require("node:fs"),
  path = require("node:path");
const base = process.argv[2] || "http://127.0.0.1:18746";
const browserPath =
  process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : undefined);
const captures = path.resolve(__dirname, "../screenshots");
fs.mkdirSync(captures, { recursive: true });
const errors = [],
  records = {};
const seen = (a, key) => a.events.find((e) => e.name === key);
async function read(p) {
  return p.evaluate(() => trialTest.read());
}
async function forward(p, n = 1) {
  return p.evaluate((n) => trialTest.advance(n), n);
}
async function until(p, predicate, max = 1800) {
  const a = await p.evaluate(
    ([fn, n]) => trialTest.advance(n, Function("return (" + fn + ")")()),
    [String(predicate), max],
  );
  assert(predicate(a), "Condition " + predicate + " at " + JSON.stringify(a));
  return a;
}
async function shot(p, name) {
  await p.screenshot({
    path: path.join(captures, name + ".png"),
    animations: "disabled",
  });
}
async function watch(p) {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("requestfailed", (r) =>
    errors.push(r.url() + " " + r.failure()?.errorText),
  );
}
async function open(ctx) {
  const p = await ctx.newPage();
  await watch(p);
  await p.goto(base + "/?verify=1", { timeout: 90000 });
  await p.waitForFunction(() => window.trialTest, null, { timeout: 60000 });
  return p;
}
async function next(p) {
  await p.keyboard.up("w");
  await p.locator("#dialogAction").click();
}
// The driver reads track survey coordinates and sends ordinary keyboard events.
// It never edits the ball, clock, checkpoints, samples or material properties.
function pilot({
  target = 10000,
  route = "high",
  fault = "",
  stop = "",
  budget = 1800,
} = {}) {
  const api = window.trialTest,
    course = api.route(),
    held = window.pilotKeys || (window.pilotKeys = new Set());
  const send = (code, down) => {
    if (down === held.has(code)) return;
    window.dispatchEvent(
      new KeyboardEvent(down ? "keydown" : "keyup", { code, bubbles: true }),
    );
    down ? held.add(code) : held.delete(code);
  };
  const tap = (code) => {
    send(code, true);
    send(code, false);
  };
  function section(s) {
    return course.find(
      (k) =>
        s >= k.a &&
        s < k.b &&
        !(k.type === "high" && route === "low") &&
        !(k.type === "low" && route === "high"),
    );
  }
  function line(s) {
    const k = section(s);
    if (!k) {
      if (s > 245 && s < 254 && route === "high") return -4.4;
      return 0;
    }
    const n = Math.max(0, Math.min(23.999, ((s - k.a) / (k.b - k.a)) * 24)),
      i = Math.floor(n),
      f = n - i;
    return k.path[i].x * (1 - f) + k.path[i + 1].x * f;
  }
  let a = api.read(),
    maxBank = 0;
  for (let i = 0; i < budget; i++) {
    if (
      a.s >= target ||
      a.mode !== "run" ||
      (stop === "launch" && a.events.some((e) => e.name === "launch")) ||
      (stop === "crack" && a.glassLoad > 0.3) ||
      (stop === "broken" && a.broken) ||
      (stop === "rail" && a.attached && a.bank > 74.8)
    )
      break;
    const s = a.s,
      k = section(s),
      type = k?.type,
      prior = course.find((q) => q.type === "alloy"),
      mag = course.find((q) => q.type === "magnet");
    let m = 1;
    if (s >= prior.a - 5 && s < prior.b + 2) m = 0;
    if (
      a.level === 2 &&
      s > prior.a &&
      s < 127 &&
      a.events.some((e) => e.name === "launch")
    )
      m = 2;
    if (s > mag.a - 5 && s < mag.b + 1) m = fault === "rail" ? 1 : 0;
    if (fault === "glass" && ((s > 80 && s < 117) || type === "glass")) m = 0;
    if (fault === "rubberGlass" && s > 83 && s < 118) m = 2;
    if (
      fault === "laser" &&
      s > 300 &&
      (type === "laser" || section(s + 3)?.type === "laser")
    )
      m = 2;
    if (m !== a.material) tap("Digit" + (m + 1));
    let pace = 19;
    if (s > 145 && s < 299) pace = route === "low" ? 8 : 10;
    if (type === "magnet" || type === "crest" || (s > 448 && s < a.finish - 7))
      pace = 14;
    if (s < prior.b + 28) pace = 30;
    if (s > prior.b && a.level === 2 && s < 123) pace = 30;
    let desired = line(s + Math.max(0.6, a.vz * 0.2));
    if (s > 207 && s < 218) desired = route === "high" ? -4.4 : 4.6;
    const lateral = (desired - a.x) * 4 - a.vx * 0.92;
    send("KeyA", type !== "magnet" && lateral < -0.8);
    send("KeyD", type !== "magnet" && lateral > 0.8);
    send("KeyW", a.vz < pace + 0.2);
    send("KeyS", a.vz > pace + 1.2);
    if (
      ((route === "high" && s > 247.2 && s < 249) ||
        (s > a.finish - 22.2 && s < a.finish - 20)) &&
      !a.pulseSpent &&
      a.jumpReadyAt <= a.time
    )
      tap("Space");
    a = api.advance(4, undefined, false);
    maxBank = Math.max(maxBank, a.attached ? a.bank : 0);
  }
  for (const key of [...held]) send(key, false);
  api.render();
  return { ...a, maxBank };
}

async function drive(p, options) {
  return p.evaluate(pilot, options);
}
async function revive(p) {
  await p.evaluate(() => {
    for (let i = 0; i < 230 && trialTest.read().mode === "failed"; i++)
      trialTest.advance(1, undefined, false);
    trialTest.render();
  });
  const a = await read(p);
  assert.equal(a.mode, "run");
  assert(Math.abs(a.s - a.station * 150) < 0.1);
  return a;
}
async function reload(p) {
  await p.reload();
  await p.waitForFunction(() => window.trialTest);
}
async function desktop(browser) {
  const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    p = await open(ctx);
  await shot(p, "01-desktop-start");
  await p.keyboard.down("ArrowRight");
  assert((await forward(p, 32)).x > 0.05);
  await p.keyboard.up("ArrowRight");
  await p.keyboard.press("r");
  await p.keyboard.press("Space");
  await forward(p, 4);
  assert((await read(p)).vy > 4);
  await p.keyboard.press("Space");
  assert.equal(
    (await read(p)).events.filter((e) => e.name === "microjump").length,
    1,
  );
  await forward(p, 146);
  await p.keyboard.press("Space");
  assert.equal(
    (await read(p)).events.filter((e) => e.name === "microjump").length,
    2,
  );
  await reload(p);
  await drive(p, { target: 19 });
  await shot(p, "02-desktop-coating");
  await drive(p, { stop: "launch" });
  await forward(p, 5);
  await shot(p, "03-desktop-alloy");
  let a = await drive(p, { fault: "glass", stop: "crack" });
  assert(a.glassLoad >= 0.3 && a.glassLoad <= 0.5 && !a.broken);
  await shot(p, "07-glass-stress");
  a = await drive(p, { fault: "glass", stop: "broken" });
  assert(a.broken);
  const crack = seen(a, "shatter");
  assert(crack.load > 0.5 && crack.load < 0.51);
  await forward(p, 24);
  await shot(p, "08-glass-collapse");
  a = await drive(p, {});
  assert.equal(a.mode, "failed");
  await revive(p);
  await reload(p);
  a = await drive(p, { fault: "rubberGlass", target: 117 });
  assert.equal(a.material, 2);
  assert(!a.broken && a.mode === "run");
  await reload(p);
  await p.keyboard.press("2");
  await p.keyboard.down("w");
  await until(p, (a) => a.s >= 10);
  await p.keyboard.up("w");
  a = await read(p);
  for (let i = 0; i < 260 && a.s < 32.2; i++) {
    if (a.v > 8.4) await p.keyboard.down("s");
    else await p.keyboard.up("s");
    a = await p.evaluate(() => trialTest.advance(8, undefined, false));
  }
  await p.keyboard.up("s");
  const timed = await until(p, (a) =>
    a.events.some((e) => e.name === "launch"),
  );
  assert.equal(seen(timed, "launch").source, "pulse");
  await reload(p);
  records.high = [];
  records.low = [];
  for (let i = 0; i < 3; i++) {
    if (i === 1) {
      await drive(p, { target: 34 });
      await shot(p, "04-desktop-fluid");
      assert(seen(await read(p), "skim"));
    }
    if (i === 0) {
      await drive(p, { target: 234 });
      await shot(p, "09-upper-fork");
      a = await drive(p, { stop: "rail" });
      assert(a.attached && a.bank >= 74.9);
      await shot(p, "10-magnetic-rail");
      await drive(p, { target: 421 });
      await shot(p, "11-laser-sweep");
    }
    a = await drive(p, {});
    assert.equal(a.mode, "finish");
    assert.equal(a.station, 3);
    assert.equal(a.count, 3);
    assert.equal(seen(a, "finish").grade, "S");
    assert(a.events.some((e) => e.name === "surface" && e.deck === "high"));
    assert((await p.locator("#dialogText").innerText()).includes("3/3"));
    records.high.push({
      length: a.finish,
      time: a.time,
      count: a.count,
      grade: seen(a, "finish").grade,
    });
    if (i === 0) await shot(p, "12-trial-result");
    await next(p);
  }
  for (let i = 0; i < 3; i++) {
    a = await drive(p, { route: "low" });
    assert.equal(a.mode, "finish");
    assert.equal(a.count, 1);
    assert.equal(seen(a, "finish").grade, "B");
    assert(a.maxBank > 74.9);
    assert(a.events.some((e) => e.name === "surface" && e.deck === "low"));
    records.low.push({ length: a.finish, time: a.time, count: a.count });
    await next(p);
  }
  await drive(p, { target: 304 });
  const saved = await read(p);
  assert.equal(saved.station, 2);
  assert.equal(saved.count, 2);
  a = await drive(p, { fault: "rail" });
  assert.equal(a.mode, "failed", "non-steel should fall from the rail");
  assert(!a.attached);
  const first = await revive(p);
  assert.equal(first.count, 2);
  assert(first.time > saved.time);
  a = await drive(p, { fault: "laser" });
  assert.equal(a.mode, "failed");
  assert(seen(a, "melt"));
  const second = await revive(p);
  assert.equal(second.station, 2);
  assert.equal(second.count, 2);
  a = await drive(p, {});
  assert.equal(a.mode, "finish");
  assert.equal(seen(a, "finish").grade, "A");
  records.recovery = {
    s: first.s,
    bankFailure: seen(a, "fail").reason,
    samples: second.count,
    retries: a.losses,
    grade: seen(a, "finish").grade,
  };
  await next(p);
  await p.keyboard.press("2");
  await p.keyboard.down("w");
  await until(p, (a) => a.s >= 10);
  await p.keyboard.up("w");
  a = await read(p);
  for (let i = 0; i < 230 && !a.sinking; i++) {
    if (a.v > 8.4) await p.keyboard.down("s");
    else await p.keyboard.up("s");
    a = await p.evaluate(() => trialTest.advance(8, undefined, false));
  }
  await p.keyboard.up("s");
  assert(a.sinking);
  await until(p, (a) => a.mode === "failed");
  await revive(p);
  assert.deepEqual(
    await p.evaluate(() =>
      [10.999, 11, 11.001].map((v) => trialTest.supportsFluid(v, 11)),
    ),
    [false, true, true],
  );
  await drive(p, { target: 156 });
  await p.keyboard.press("r");
  a = await read(p);
  assert.equal(a.station, 1);
  assert.equal(a.s, 150);
  await p.locator("#helpBtn").click();
  assert.equal((await read(p)).mode, "help");
  await p.keyboard.press("Escape");
  const high = (await read(p)).high;
  await p.locator("#quality").click();
  assert.notEqual((await read(p)).high, high);
  await p.mouse.move(780, 440);
  await p.mouse.down();
  await p.mouse.move(810, 450);
  await p.mouse.up();
  await p.mouse.wheel(0, 130);
  await p.waitForTimeout(100);
  a = await read(p);
  assert(a.yaw !== 0.22 && a.zoom > 10.8);
  assert.equal(a.audio, "running");
  await ctx.close();
}

async function mobile(browser, width, height, portrait) {
  const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    }),
    p = await open(ctx),
    cdp = await ctx.newCDPSession(p);
  const box = await p.locator("#pad").boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2,
    r = box.width * 0.34;
  const finger = (id, x, y) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 });
  const send = (type, ...touchPoints) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  const start = async () => {
    await send("touchStart", finger(1, x, y));
    await send("touchMove", finger(1, x, y - r));
  };
  const stop = () => send("touchEnd");
  const rects = await p.evaluate(() => {
    const sels = [
      ".stage",
      ".course",
      "#pad",
      ".choices",
      "#reset",
      "#jump",
      ".scene-tag",
      "header",
    ];
    return sels.map((s) => {
      const b = document.querySelector(s).getBoundingClientRect();
      return [s, b.left, b.top, b.right, b.bottom];
    });
  });
  for (const [n, l, t, r, b] of rects)
    assert(
      l >= -0.5 && t >= -0.5 && r <= width + 0.5 && b <= height + 0.5,
      "offscreen " + n,
    );
  for (let i = 0; i < rects.length; i++)
    for (let j = 0; j < i; j++) {
      const [a, l, t, r, b] = rects[i],
        [c, L, T, R, B] = rects[j];
      assert(
        Math.min(r, R) - Math.max(l, L) <= 0.5 ||
          Math.min(b, B) - Math.max(t, T) <= 0.5,
        "overlap " + a + " " + c,
      );
    }
  await start();
  await forward(p, 45);
  let a = await read(p);
  assert(a.joy.y > 0.98 && a.s > 0);
  const cameraX = width * 0.55,
    cameraY = height * 0.42;
  const held = finger(1, x, y - r);
  await send("touchStart", held, finger(2, cameraX, cameraY));
  await send("touchMove", held, finger(2, cameraX + 18, cameraY + 6));
  await send("touchEnd", finger(2, cameraX + 18, cameraY + 6));
  assert((await read(p)).yaw !== 0.22);
  const mat = await p.locator('[data-m="1"]').boundingBox();
  await send(
    "touchStart",
    held,
    finger(3, mat.x + mat.width * 0.5, mat.y + mat.height * 0.5),
  );
  await send(
    "touchEnd",
    finger(3, mat.x + mat.width * 0.5, mat.y + mat.height * 0.5),
  );
  a = await read(p);
  assert.equal(a.material, 1);
  assert(a.joy.y > 0.98);
  await until(p, (a) => a.s > 14);
  const jump = await p.locator("#jump").boundingBox();
  assert(jump.width >= 44 && jump.height >= 44);
  const jf = finger(4, jump.x + jump.width / 2, jump.y + jump.height / 2);
  await send("touchStart", held, jf);
  await send("touchEnd", jf);
  a = await forward(p, 6);
  assert(a.joy.y > 0.98 && a.vy > 4 && a.pulseSpent);
  await send("touchStart", held, jf);
  await send("touchEnd", jf);
  assert.equal(
    (await read(p)).events.filter((e) => e.name === "microjump").length,
    1,
  );
  await shot(p, portrait ? "05-mobile-portrait" : "06-mobile-landscape");
  await stop();
  assert.equal((await read(p)).joy.y, 0);
  await p.locator("#reset").tap();
  await start();
  a = await until(p, (a) => a.broken);
  assert(seen(a, "launch") && seen(a, "shatter"));
  await stop();
  await until(p, (a) => a.mode === "failed");
  await revive(p);
  await drive(p, { target: 352 });
  await p.locator('[data-m="0"]').tap();
  await start();
  a = await until(p, (a) => a.attached && a.bank > 74.9);
  assert.equal(a.material, 0);
  await until(p, (a) => a.s > 402);
  await stop();
  assert.equal((await read(p)).mode, "run");
  await p.locator('[data-m="2"]').tap();
  await start();
  a = await until(p, (a) => a.mode === "failed");
  assert(seen(a, "melt"));
  await stop();
  const restored = await revive(p);
  assert.equal(restored.s, 300);
  assert.equal(restored.count, 2);
  await ctx.close();
}

async function realTime(browser) {
  const p = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await watch(p);
  await p.goto(base, { timeout: 90000 });
  await p.waitForSelector("body[data-ready=true]");
  await p.keyboard.down("w");
  await p.waitForFunction(
    () => Number(document.getElementById("distance").textContent) >= 3,
    null,
    { timeout: 30000 },
  );
  await p.keyboard.up("w");
  await p.close();
}
(async () => {
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    await desktop(browser);
    await mobile(browser, 390, 844, true);
    await mobile(browser, 844, 390, false);
    await realTime(browser);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ consoleErrors: errors, ...records }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
