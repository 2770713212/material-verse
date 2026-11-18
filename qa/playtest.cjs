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
  await p.keyboard.press("2");
  await p.keyboard.down("w");
  await until(p, (a) => a.s > 19);
  await shot(p, "02-desktop-coating");
  await p.keyboard.press("1");
  const launch = await until(
    p,
    (a) => a.events.some((e) => e.name === "launch") && a.vy > 10 && a.y > 1.15,
  );
  await shot(p, "03-desktop-alloy");
  const finish = await until(p, (a) => a.mode === "finish");
  assert(seen(finish, "land") && seen(launch, "launch").source === "steel");
  records.desktopLaunch = seen(launch, "launch");
  records.desktopLanding = seen(finish, "land");
  await next(p);
  // Enter the pool slowly using the brake and throttle, without moving the ball by script.
  await p.keyboard.press("2");
  await p.keyboard.down("w");
  await until(p, (a) => a.s >= 10);
  await p.keyboard.up("w");
  let a = await read(p);
  for (let i = 0; i < 230 && !a.sinking; i++) {
    if (a.v > 8.4) await p.keyboard.down("s");
    else await p.keyboard.up("s");
    a = await forward(p, 8);
    if (a.mode !== "run") break;
  }
  await p.keyboard.up("s");
  assert(a.sinking, "slow entry did not sink " + JSON.stringify(a));
  const sunk = await until(p, (a) => a.mode === "failed");
  assert(sunk.y < 0);
  records.desktopSink = seen(sunk, "sink");
  await p.keyboard.press("r");
  await p.keyboard.press("2");
  await p.keyboard.down("w");
  const skim = await until(p, (a) => a.s >= 34 && a.deck === "fluid");
  assert(skim.v >= skim.threshold && !skim.sinking);
  await shot(p, "04-desktop-fluid");
  records.desktopSkim = seen(skim, "skim");
  await until(p, (a) => a.s > 47);
  await p.keyboard.press("1");
  await until(p, (a) => a.mode === "finish");
  await next(p);
  await p.keyboard.press("2");
  await p.keyboard.down("w");
  await until(p, (a) => a.s > 44);
  await p.keyboard.press("1");
  await until(p, (a) => a.events.some((e) => e.name === "launch"));
  await p.keyboard.press("3");
  const last = await until(p, (a) => a.mode === "finish");
  assert(
    last.events.filter((e) => e.name === "land" && e.deck === "bounce")
      .length >= 2,
  );
  records.rebounds = last.events.filter((e) => e.name === "land");
  await next(p);
  assert.equal((await read(p)).level, 0);
  // A nonconductive specimen waits on NiTi. Only the timed pulse can launch it.
  await p.keyboard.press("2");
  await p.keyboard.down("w");
  await until(p, (a) => a.s >= 10);
  await p.keyboard.up("w");
  a = await read(p);
  for (let i = 0; i < 260 && a.s < 32.2; i++) {
    if (a.v > 8.4) await p.keyboard.down("s");
    else await p.keyboard.up("s");
    a = await forward(p, 8);
  }
  await p.keyboard.up("s");
  const pulse = await until(p, (a) =>
    a.events.some((e) => e.name === "launch"),
  );
  assert.equal(seen(pulse, "launch").source, "pulse");
  assert(!pulse.events.some((e) => e.name === "heat" && e.source === "steel"));
  records.periodicLaunch = seen(pulse, "launch");
  assert.deepEqual(
    await p.evaluate(() =>
      [10.999, 11, 11.001].map((v) => trialTest.supportsFluid(v, 11)),
    ),
    [false, true, true],
  );
  await p.keyboard.press("r");
  await p.locator("#helpBtn").click();
  assert.equal((await read(p)).mode, "help");
  await p.keyboard.press("Escape");
  assert.equal((await read(p)).mode, "run");
  const q = (await read(p)).high;
  await p.locator("#quality").click();
  assert.notEqual((await read(p)).high, q);
  await p.mouse.move(760, 430);
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
    const sels = [".stage", ".course", "#pad", ".choices", "#reset", "header"];
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
  await shot(p, portrait ? "05-mobile-portrait" : "06-mobile-landscape");
  await stop();
  assert.equal((await read(p)).joy.y, 0);
  await p.locator("#reset").tap();
  await start();
  const finish = await until(p, (a) => a.mode === "finish");
  assert(seen(finish, "launch") && seen(finish, "land"));
  await stop();
  if (portrait) {
    records.touchLaunch = seen(finish, "launch");
    records.touchLanding = seen(finish, "land");
    await p.locator("#dialogAction").tap();
    await p.locator('[data-m="1"]').tap();
    await start();
    const skim = await until(p, (a) => a.s > 35);
    assert(seen(skim, "skim"));
    records.touchSkim = seen(skim, "skim");
    await stop();
    await p.locator("#reset").tap();
    await p.locator('[data-m="1"]').tap();
    await start();
    await until(p, (a) => a.s >= 10);
    a = await read(p);
    for (let i = 0; i < 230 && !a.sinking; i++) {
      await send("touchMove", finger(1, x, a.v > 8.4 ? y + r : y));
      a = await forward(p, 8);
      if (a.mode !== "run") break;
    }
    assert(a.sinking);
    await stop();
    const sunk = await until(p, (a) => a.mode === "failed");
    assert(sunk.y < 0);
    records.touchSink = seen(sunk, "sink");
  }
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
