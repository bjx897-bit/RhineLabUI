import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--disable-gpu-rasterization",
  ],
});
const output = resolve(
  process.env.PRESENTATION_OUTPUT || "work/presentation-check",
);
await mkdir(output, { recursive: true });
const base = process.env.REVIEW_URL || "http://127.0.0.1:5173";
const removed =
  '#boot, #skip, .entry-start, [data-action="settings"], [data-action="replay"], [data-action="restart"], [data-action="model-viewer"], .viewer-modal, audio, video';
const checks = [];
async function capture(page, name) {
  if (process.env.PRESENTATION_CAPTURE !== "1") return;
  // Capture the current real scene without continuously adding software GPU
  // work while Chromium reads back the canvas.
  await page.evaluate(() => {
    window.capturePaused = true;
  });
  try {
    await page.screenshot({ path: `${output}/${name}.png`, timeout: 60000 });
  } finally {
    await page.evaluate(() => {
      window.capturePaused = false;
      for (const callback of window.pendingFrames.splice(0))
        requestAnimationFrame(callback);
    });
  }
}
try {
  for (const legacy of [false, true]) {
    // Exercise reading flows with the OS accessibility preference, and verify
    // the second entry with normal motion plus legacy application preferences.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      acceptDownloads: true,
      reducedMotion: legacy ? "no-preference" : "reduce",
    });
    await context.addInitScript((legacy) => {
      // Software WebGL in CI needs backpressure to avoid a render queue growing
      // faster than SwiftShader can drain it during screenshot readback.
      const requestFrame = window.requestAnimationFrame.bind(window);
      window.pendingFrames = [];
      window.requestAnimationFrame = (callback) =>
        requestFrame(() =>
          setTimeout(() => {
            if (window.capturePaused) window.pendingFrames.push(callback);
            else callback(performance.now());
          }, 1000),
        );
      window.audioContextCreations = 0;
      for (const key of ["AudioContext", "webkitAudioContext"]) {
        if (window[key])
          window[key] = new Proxy(window[key], {
            construct(target, args) {
              window.audioContextCreations++;
              return Reflect.construct(target, args);
            },
          });
      }
      if (legacy)
        localStorage.setItem(
          "rhine-settings",
          JSON.stringify({
            sound: true,
            music: true,
            superPerformance: false,
            colorTheme: "dark",
            rendering: {
              scale: 200,
              pixelRatio: 3,
              shadows: 4096,
              aoSamples: 64,
              depthOfField: 150,
              antialias: "smaa",
            },
          }),
        );
    }, legacy);
    let page = await context.newPage();
    page.setDefaultTimeout(60000);
    console.log(`Checking ${legacy ? "legacy" : "fresh"} browser entry`);
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(
      `${base}/${legacy ? "?time=28&freeze=1&scene=detail" : ""}`,
    );
    await page.waitForFunction(
      () => window.rhine?.stats().startup === "started",
      null,
      { timeout: 60000 },
    );
    await page.locator("#loading").waitFor({ state: "detached" });
    const stats = await page.evaluate(() => rhine.stats());
    console.log(
      JSON.stringify({
        mode: stats.mode,
        archives: stats.archiveCount,
        candidates: stats.archiveCandidates,
        rendering: stats.rendering,
      }),
    );
    assert.equal(
      stats.mode,
      "archive",
      "entry needs no gesture and never runs the opening",
    );
    assert.equal(stats.superPerformance, true);
    assert.equal(stats.baseQuality, "original");
    assert.equal(stats.postprocessing, false);
    assert.ok(stats.archiveCount > 40, "visible archive array is populated");
    const metrics = await page
      .locator("#three-scene")
      .evaluate((el) => JSON.parse(el.dataset.renderQuality));
    assert.equal(metrics.aoWidth, 0);
    assert.equal(metrics.aoHeight, 0);
    assert.equal(metrics.shadows, 0);
    assert.equal(metrics.depthOfField, 0);
    assert.ok(metrics.width * metrics.height <= 921600);
    assert.equal(await page.locator(removed).count(), 0);
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".three-scene")).opacity ===
        "1",
    );
    assert.equal(await page.evaluate(() => window.audioContextCreations), 0);
    checks.push(
      legacy
        ? "Normal-motion entry ignores legacy preferences and opening query parameters"
        : "Fresh visit with OS reduced motion opens the populated array automatically using only lightweight rendering",
    );
    if (!legacy) {
      await capture(page, "archive-desktop");
      console.log("Desktop array visible");
      const initial = stats.selected;
      await page.keyboard.press("ArrowDown");
      assert.notEqual(
        await page.evaluate(() => rhine.stats().selected),
        initial,
      );
      await page.keyboard.press("/");
      await page.locator("#archive-search").waitFor();
      assert.equal(await page.locator(".result-row").count(), 40);
      await page.locator("#archive-search").fill("X-001");
      assert.equal(await page.locator(".result-row").count(), 1);
      await page.locator(".result-row").click();
      await page.waitForFunction(
        () =>
          rhine.stats().mode === "detail" &&
          rhine.stats().decryption.modelClarity >= 0.99 &&
          rhine.stats().cameraDetail >= 0.99,
        null,
        { timeout: 60000 },
      );
      assert.equal(await page.locator(removed).count(), 0);
      await page.locator('[data-tab="notes"]').click();
      assert.ok((await page.locator(".research-notes li").count()) > 0);
      await page.locator('[data-action="bookmark"]').click();
      assert.ok(
        (await page.evaluate(() => rhine.stats().saved)).includes("X-001"),
      );
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator(".export-button").click(),
      ]);
      const content = await readFile(await download.path(), "utf8");
      assert.ok(content.includes("莱茵生命"));
      await capture(page, "detail-desktop");
      await page.keyboard.press("Escape");
      await page.locator('[data-action="saved"]').click();
      assert.equal(await page.locator(".result-row").count(), 1);
      await page.keyboard.press("Escape");
      await page.locator(".terminal-modal").waitFor({ state: "detached" });
      checks.push(
        "Navigation, all 40 archive records, search, detail tabs, bookmarks and text export work",
      );
      console.log("Archive interactions passed");
      // A fresh mobile surface avoids resizing an in-flight software WebGL
      // buffer; responsive geometry itself is covered by check:viewport.
      await page.close();
      page = await context.newPage();
      page.setDefaultTimeout(60000);
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => requests.push(request.url()));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(base);
      await page.waitForFunction(
        () => window.rhine?.stats().startup === "started",
        null,
        { timeout: 60000 },
      );
      await capture(page, "archive-mobile");
      await page.locator(".read-file").click();
      await page.waitForFunction(
        () =>
          rhine.stats().decryption.modelClarity >= 0.99 &&
          rhine.stats().cameraDetail >= 0.99,
      );
      await page.locator('[data-tab="notes"]').click();
      await capture(page, "detail-mobile");
      const detail = await page.locator("#detail-content").boundingBox();
      assert.ok(
        detail.width <= 390 && detail.x >= -1 && detail.x + detail.width <= 391,
      );
      assert.equal(
        await page.locator("canvas").count(),
        1,
        "detail keeps only the main scene canvas",
      );
      assert.equal(
        await page.evaluate(() => rhine.stats().postprocessing),
        false,
      );
      checks.push(
        "Portrait layout remains readable and detail uses the same lightweight scene",
      );
    }
    // Let production PWA installation request its offline resources too.
    await page.waitForTimeout(2000);
    assert.deepEqual(
      requests.filter((url) =>
        /\/audio\/|archive-assembly|novecento/i.test(url),
      ),
      [],
    );
    assert.equal(await page.evaluate(() => window.audioContextCreations), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify({ checks, errors: [], output }, null, 2));
} finally {
  await browser.close();
}
