import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const uiOnly = process.env.PRESENTATION_UI_ONLY === "1";
const captureEnabled = process.env.PRESENTATION_CAPTURE === "1";
if (uiOnly && captureEnabled)
  throw new Error(
    "UI-only checks hide the 3D compositor and cannot produce visual screenshots.",
  );
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
if (captureEnabled) await mkdir(output, { recursive: true });
const base = process.env.REVIEW_URL || "http://127.0.0.1:5173";
const removed = [
  ".brand",
  ".system-nav",
  "#modal-root",
  "#archive-search",
  ".terminal-modal",
  '[data-action="search"]',
  '[data-action="saved"]',
  '[data-action="bookmark"]',
  "#boot",
  "#skip",
  ".entry-start",
  '[data-action="settings"]',
  '[data-action="replay"]',
  '[data-action="restart"]',
  '[data-action="model-viewer"]',
  ".viewer-modal",
  '[role="tablist"]',
  '[role="tab"]',
  '[role="tabpanel"]',
  "#tab-panel",
  ".document-redacted",
  ".document-redaction-window",
  ".document-redaction-ink",
  "audio",
  "video",
].join(", ");
const checks = [];
const profileFields = [
  ["姓名", "张三"],
  ["专业", "计算机科学与技术"],
  ["学校", "示例大学"],
  ["意向岗位", "前端开发工程师"],
];
let skippedMainSceneDraws = 0;
async function capture(page, name) {
  if (!captureEnabled) return;
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
async function checkRemovedShortcuts(page) {
  const before = await page.evaluate(() => ({
    mode: rhine.stats().mode,
    selected: rhine.stats().selected,
  }));
  await page.evaluate(() => document.activeElement?.blur());
  for (const key of ["/", "Home"]) {
    await page.keyboard.press(key);
    assert.deepEqual(
      await page.evaluate(() => ({
        mode: rhine.stats().mode,
        selected: rhine.stats().selected,
      })),
      before,
    );
    assert.equal(await page.locator(removed).count(), 0);
  }
}
async function checkDetailDisplayOnly(page) {
  const waitFrames = async () => {
    const frame = await page.evaluate(() => {
      const stats = rhine.stats();
      return stats.renderedFrames + stats.reusedFrames;
    });
    await page.waitForFunction((previous) => {
      const stats = rhine.stats();
      return stats.renderedFrames + stats.reusedFrames >= previous + 3;
    }, frame);
  };
  await page.waitForFunction(() => {
    const stats = rhine.stats();
    return (
      stats.cameraDetail >= 0.999 &&
      stats.extraction >= 4.049 &&
      document.querySelector("#three-scene").dataset.inspection === "display"
    );
  });
  await waitFrames();
  const before = await page.evaluate(() => rhine.stats());
  assert.equal(before.canInspect, false);
  assert.equal(
    await page
      .locator("#three-scene canvas")
      .evaluate((canvas) => getComputedStyle(canvas).pointerEvents),
    "none",
  );
  assert.ok(
    !(await page.locator("#detail-ui").innerText()).includes("DRAG TO INSPECT"),
  );
  for (const input of ["mouse", "touch", "wheel"]) {
    // Dispatch directly to the canvas as well as checking CSS above: scene
    // handlers must reject detail input even when hit testing is bypassed.
    await page.locator("#three-scene canvas").evaluate((canvas, input) => {
      const rect = canvas.getBoundingClientRect();
      const point = {
        clientX: rect.left + rect.width * 0.28,
        clientY: rect.top + rect.height * 0.52,
      };
      if (input === "wheel") {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            ...point,
            deltaY: 600,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else {
        const pointer = {
          ...point,
          pointerId: input === "mouse" ? 1 : 2,
          pointerType: input,
          isPrimary: true,
          bubbles: true,
        };
        canvas.dispatchEvent(
          new PointerEvent("pointerdown", { ...pointer, buttons: 1 }),
        );
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            ...pointer,
            clientX: point.clientX + 180,
            clientY: point.clientY - 60,
            buttons: 1,
          }),
        );
        canvas.dispatchEvent(new PointerEvent("pointerup", pointer));
        canvas.dispatchEvent(new PointerEvent("pointerleave", pointer));
      }
    }, input);
    await waitFrames();
    const after = await page.evaluate(() => rhine.stats());
    assert.equal(after.mode, "detail", `${input}: detail remains open`);
    assert.equal(
      after.selected,
      before.selected,
      `${input}: selection is unchanged`,
    );
    assert.equal(after.canInspect, false);
    for (const [key, tolerance] of [
      ["rotation", 1e-5],
      ["fieldOfView", 1e-3],
      ["extraction", 1e-3],
    ])
      assert.ok(
        Math.abs(after[key] - before[key]) <= tolerance,
        `${input}: ${key} is unchanged`,
      );
    for (const [key, tolerance] of [
      ["cameraPosition", 0.01],
      ["cameraQuaternion", 1e-3],
      ["modelPosition", 0.01],
    ])
      after[key].forEach((value, index) =>
        assert.ok(
          Math.abs(value - before[key][index]) <= tolerance,
          `${input}: ${key}[${index}] is unchanged`,
        ),
      );
  }
}
try {
  for (const legacy of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      acceptDownloads: true,
      reducedMotion: legacy ? "no-preference" : "reduce",
      serviceWorkers: uiOnly ? "block" : "allow",
    });
    if (uiOnly) {
      // Intercept only the test response. Scene/state updates still run, while
      // the expensive main-scene draw is skipped on software-only CI machines.
      await context.route(
        /\/(?:src\/scene\.ts|assets\/index-[^/]+\.js)(?:\?.*)?$/,
        async (route) => {
          const response = await route.fetch();
          const original = await response.text();
          const body = original.replace(
            /this\.renderer\.render\(this\.scene,\s*this\.camera\)/g,
            () => {
              skippedMainSceneDraws++;
              return "void 0";
            },
          );
          assert.notEqual(
            body,
            original,
            "UI-only draw adapter must match the scene renderer",
          );
          await route.fulfill({ response, body });
        },
      );
    }
    await context.addInitScript(
      ({ legacy, uiOnly }) => {
        if (uiOnly) {
          // Keep scene/state calculations, but suppress drawing/composition in
          // this test browser. This mode checks DOM behavior, not visuals.
          const installStyle = () => {
            if (!document.documentElement) return false;
            const style = document.createElement("style");
            style.textContent = "#three-scene { opacity: 0 !important; }";
            document.documentElement.append(style);
            return true;
          };
          if (!installStyle()) {
            const observer = new MutationObserver(() => {
              if (installStyle()) observer.disconnect();
            });
            observer.observe(document, { childList: true, subtree: true });
          }
        }
        // Throttle only this test browser, without changing product animation.
        const requestFrame = window.requestAnimationFrame.bind(window);
        window.pendingFrames = [];
        window.requestAnimationFrame = (callback) =>
          requestFrame(() =>
            setTimeout(
              () => {
                if (window.capturePaused) window.pendingFrames.push(callback);
                else callback(performance.now());
              },
              uiOnly ? 100 : 1000,
            ),
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
        if (legacy) {
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
          localStorage.setItem(
            "rhine-saved",
            JSON.stringify(["X-001", "X-007"]),
          );
        }
        window.savedStorageAccesses = [];
        for (const method of ["getItem", "setItem", "removeItem"]) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (...args) {
            if (this === localStorage && args[0] === "rhine-saved")
              window.savedStorageAccesses.push(method);
            return Reflect.apply(original, this, args);
          };
        }
      },
      { legacy, uiOnly },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    console.log(
      `Checking ${legacy ? "legacy" : "fresh"} entry (${uiOnly ? "DOM only" : "graphics enabled"})`,
    );
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
    assert.equal(stats.mode, "archive");
    assert.equal(stats.superPerformance, true);
    assert.equal(stats.baseQuality, "original");
    assert.equal(stats.postprocessing, false);
    assert.ok(stats.archiveCount > 0, "decorative archive scene is populated");
    assert.equal(stats.selected, "X-001");
    assert.equal(await page.locator(".count-total").innerText(), "01");
    assert.equal(await page.locator("#file-ticks button").count(), 1);
    assert.match(
      await page.locator("#column-number").innerText(),
      /\/\s*01\s*$/,
    );
    assert.equal(
      await page.locator("#archive-category .rn-value").textContent(),
      "个人信息",
    );
    assert.equal(
      await page.locator("#column-name .rn-value").textContent(),
      "个人信息",
    );
    const metrics = await page
      .locator("#three-scene")
      .evaluate((el) => JSON.parse(el.dataset.renderQuality));
    assert.equal(metrics.aoWidth, 0);
    assert.equal(metrics.aoHeight, 0);
    assert.equal(metrics.shadows, 0);
    assert.equal(metrics.depthOfField, 0);
    assert.ok(metrics.width * metrics.height <= 921600);
    assert.equal(await page.locator(removed).count(), 0);
    assert.equal(
      await page.locator("#archive-category").count(),
      1,
      "archive category remains available",
    );
    if (!uiOnly)
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".three-scene")).opacity ===
          "1",
      );
    await checkRemovedShortcuts(page);
    checks.push(
      legacy
        ? "Legacy bookmarks/settings and old entry queries cannot restore removed features"
        : "Direct archive entry has no brand heading, search or bookmark controls",
    );
    const initial = stats.selected;
    for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"]) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => rhine.stats().selected), initial);
    }
    for (const selector of [
      '[data-action="prev"]',
      '[data-action="next"]',
      '[data-action="column-prev"]',
      '[data-action="column-next"]',
      "#file-ticks button",
    ]) {
      await page.locator(selector).evaluate((button) => button.click());
      assert.equal(await page.evaluate(() => rhine.stats().selected), initial);
    }
    if (!legacy) await capture(page, "archive-desktop");
    // One browser task: verify opening exposes the whole document synchronously,
    // before an animation frame or model decryption can reveal it later.
    const opened = await page.evaluate(() => {
      document.querySelector(".read-file").click();
      const content = document.querySelector("#detail-content");
      const detail = document.querySelector("#detail-ui");
      const fields = content.querySelector(".profile-fields");
      return {
        mode: rhine.stats().mode,
        hidden: detail.hidden,
        surfaceOpacity: getComputedStyle(detail).opacity,
        opacity: getComputedStyle(content).opacity,
        inert: content.inert || detail.inert,
        fieldTag: fields?.tagName,
        labels: Array.from(fields?.querySelectorAll("dt") ?? [], (el) =>
          el.textContent.trim(),
        ),
        values: Array.from(fields?.querySelectorAll("dd") ?? [], (el) =>
          el.textContent.trim(),
        ),
      };
    });
    assert.deepEqual(opened, {
      mode: "detail",
      hidden: false,
      surfaceOpacity: "1",
      opacity: "1",
      inert: false,
      fieldTag: "DL",
      labels: profileFields.map(([label]) => label),
      values: profileFields.map(([, value]) => value),
    });
    assert.equal(await page.locator(removed).count(), 0);
    await checkRemovedShortcuts(page);
    checks.push(
      `${legacy ? "Normal" : "Reduced"} motion: one personal file; all four fields appear immediately without tabs or document decryption`,
    );
    if (!legacy) {
      await checkDetailDisplayOnly(page);
      checks.push(
        "Detail extraction reaches display state; mouse/touch drag and wheel cannot rotate, move the camera or change selection",
      );
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator(".export-button").click(),
      ]);
      assert.equal(download.suggestedFilename(), `RHINE-LAB-${initial}.txt`);
      const content = await readFile(await download.path(), "utf8");
      for (const [label, value] of profileFields)
        assert.match(content, new RegExp(`${label}[：:]\\s*${value}`));
      assert.doesNotMatch(
        content,
        /研究记录|访问日志|莱茵生命|Kristen|Saria|设定参考|编目范围|总辖构件科/,
      );
      await capture(page, "detail-desktop");
      checks.push(
        "TXT export contains the four personal fields and no previous research content",
      );
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => rhine.stats().mode), "archive");
    await page.waitForFunction(() => {
      const stats = rhine.stats();
      return (
        stats.cameraDetail <= 0.001 &&
        stats.extraction <= 0.401 &&
        document.querySelector("#three-scene").dataset.inspection === "preview"
      );
    });
    assert.equal(await page.evaluate(() => rhine.stats().selected), initial);
    assert.notEqual(
      await page
        .locator("#three-scene canvas")
        .evaluate((canvas) => getComputedStyle(canvas).pointerEvents),
      "none",
    );
    assert.equal(await page.locator("canvas").count(), 1);
    await page.waitForTimeout(2000);
    assert.deepEqual(
      requests.filter((url) =>
        /\/audio\/|archive-assembly|novecento/i.test(url),
      ),
      [],
    );
    assert.equal(await page.evaluate(() => window.audioContextCreations), 0);
    assert.deepEqual(
      await page.evaluate(() => window.savedStorageAccesses),
      [],
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    JSON.stringify(
      {
        mode: uiOnly
          ? "DOM/state only; main scene drawing skipped, no visual or GPU validation"
          : "graphics enabled",
        checks,
        errors: [],
        ...(uiOnly ? { skippedMainSceneDraws } : {}),
        ...(captureEnabled ? { output } : {}),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
