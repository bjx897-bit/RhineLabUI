import { createRollingClock } from "./rolling-clock";
import { InspectionOverlay } from "./inspection-overlay";
import "./decryption.css";
import { escapeHtml } from "./html";
import { qualityPresets } from "./render-quality";
import { superPerformanceQuality } from "./wallpaper-quality";
import "@kitlangton/rolling-number/styles.css";
import "./style.css";
import "./responsive.css";
import { viewportLayout } from "./viewport-layout";
import { assetUrl } from "./asset-url";
import { initPwa } from "./pwa";
import {
  createRollingNumber,
  createRollingText,
} from "@kitlangton/rolling-number";
import { ArchiveScene } from "./scene";
import { SurfaceTransition } from "./ui-transitions";
import { wrap, type ArchiveNavigation } from "./archive-loop";
import { records, archiveColumns, columnFiles, fileLocation } from "./data";
import {
  createMotionPreferences,
  motionEnabled,
  motionPresetFor,
  type MotionKey,
} from "./motion-preferences";
import { paintTheme } from "./theme-ui";
import { enableGamepad, onInputDevice } from "./gamepad";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

$("#stage").innerHTML = `
  <div id="three-scene" class="three-scene"></div>
  <div class="scene-atmosphere archive-atmosphere"></div>
  <svg id="inspection-marks" viewBox="0 0 1920 1080" aria-hidden="true"><path id="inspection-lines"/><g id="inspection-corners"></g><circle id="inspection-point" r="1.8"/></svg>
  <div id="inspection-text" aria-hidden="true">CONFIDENTIALITY:<strong>GENERAL BUSINESS USE</strong></div>
  <section id="archive-ui" class="archive-ui" aria-label="档案选择">
    <div class="archive-callout"><div class="eyebrow">PERSONAL ARCHIVE <span>／</span> <span id="archive-category">${escapeHtml(records[0].category)}</span></div><button class="file-title" data-action="open">FILE NUMBER: <span id="selected-id">X-<span id="selected-code">001</span></span><span class="file-open">↗</span></button><div class="callout-rule"><i></i></div><div class="file-summary"><span id="selected-title">${escapeHtml(records[0].title)}</span><span id="selected-role">${escapeHtml(records[0].targetRole)}</span></div><button class="read-file" data-action="open">ACCESS FILE <span>→</span></button></div>
    <div id="hover-label" class="hover-label" hidden>X-<span id="hover-code">001</span> / <span id="hover-title"></span></div>
    <div class="archive-counter"><span class="tiny-label">ARCHIVE / SELECT</span><div><span id="selected-number">01</span><i>/</i><span class="count-total">01</span></div></div>
    <div class="archive-navigation"><button data-action="prev" aria-label="上一个档案">↑</button><div id="file-ticks" class="file-ticks"></div><button data-action="next" aria-label="下一个档案">↓</button></div>
    <div class="column-navigation"><button data-action="column-prev" aria-label="上一分类">←</button><div><span id="column-number">CATEGORY <span id="column-index">01</span> / ${String(archiveColumns.length).padStart(2, "0")}</span><strong id="column-name">${escapeHtml(archiveColumns[0])}</strong></div><button data-action="column-next" aria-label="下一分类">→</button></div>
    <div class="archive-hint"><kbd>ENTER</kbd> 读取档案</div>
  </section>
  <section id="detail-ui" class="detail-ui" aria-label="档案内容" hidden>
    <button class="back-button" data-action="back">← <span>ARCHIVE OVERVIEW</span><small>ESC</small></button>
    <div class="object-caption"><span id="object-id">NO.001</span><div>INTERNAL DATABASE</div></div>
    <article id="detail-content" class="detail-content"></article>
  </section>
  <footer class="system-footer"><span><i class="status-light"></i> SESSION AUTHORIZED</span><span><span id="profile-owner">${escapeHtml(records[0].name)}</span> <i>／</i> <span id="clock">00:00:00</span></span><a href="${assetUrl("fonts/MiSans-license.pdf")}" target="_blank" rel="noopener" aria-label="MiSans 字体许可">MiSans · 字体许可 ↗</a></footer>
  <div id="pwa-update-notice" class="pwa-update-notice" role="status" hidden><span>新版本已就绪</span><button data-pwa-action="update">更新并重启 ↻</button></div>
  <div id="toast" class="toast" role="status"></div>
  <div id="loading" class="loading" role="status"><span>正在加载资料库…</span></div>
`;

type Mode = "archive" | "detail";
let mode: Mode = "archive",
  selected = 0,
  ready = false;
$("#stage").dataset.mode = "archive";
let toastTimer: ReturnType<typeof setTimeout>;
const detailTransition = new SurfaceTransition(
  $("#detail-ui"),
  undefined,
  180,
  180,
);
// Presentation configuration is fixed; legacy browser settings cannot restore
// sound, the opening, or the full rendering pipeline.
const motion = createMotionPreferences(
  undefined,
  matchMedia("(prefers-reduced-motion: reduce)").matches,
);
motion.boot = false;
motion.documentReveal = false;
const prefs = {
  motion,
  motionPreset: motionPresetFor(motion),
  superPerformance: true,
  rendering: { ...qualityPresets.original },
  colorTheme: "light" as const,
};
const motionActive = (key: MotionKey) => motionEnabled(prefs.motion, key);
const motionIsReduced = () =>
  Object.values(prefs.motion).every((value) => !value);
paintTheme(0);
const rollingMotion = {
  duration: 460,
  motionBlur: true,
  animated: motionActive("rollingNumbers"),
};
const updateFooterClock = createRollingClock($("#clock"));
const numberOptions = {
  ...rollingMotion,
  locales: "en-US",
  format: { minimumIntegerDigits: 2, useGrouping: false },
};
const fileCounter = createRollingNumber($("#selected-number"), {
  ...numberOptions,
  value: 1,
});
const columnCounter = createRollingNumber($("#column-index"), {
  ...numberOptions,
  value: 1,
});
const codeOptions = {
  ...numberOptions,
  format: { minimumIntegerDigits: 3, useGrouping: false },
  value: 1,
};
const textOptions = {
  ...rollingMotion,
  animated: motionActive("rollingText"),
  transition: "direct" as const,
  stagger: "none" as const,
};
const selectionTitle = createRollingText($("#selected-title"), {
  ...textOptions,
  text: $("#selected-title").textContent ?? "",
});
const columnTitle = createRollingText($("#column-name"), {
  ...textOptions,
  text: $("#column-name").textContent ?? "",
});
const hoverTitle = createRollingText($("#hover-title"), {
  ...textOptions,
  text: "",
});
const categoryTitle = createRollingText($("#archive-category"), {
  ...textOptions,
  text: $("#archive-category").textContent ?? "",
});
const roleTitle = createRollingText($("#selected-role"), {
  ...textOptions,
  text: $("#selected-role").textContent ?? "",
});
const rollingTitles = [
  selectionTitle,
  columnTitle,
  hoverTitle,
  categoryTitle,
  roleTitle,
];
const selectedCode = createRollingNumber($("#selected-code"), codeOptions);
const hoverCode = createRollingNumber($("#hover-code"), codeOptions);
let started = false;
const loading = $("#loading");
$("#viewport").append(loading);
$("#stage").inert = true;
let scene: ArchiveScene | undefined;
const columnMemory = archiveColumns.map((_, lane) => columnFiles(lane)[0]);
function effectiveRenderQuality() {
  return { ...prefs.rendering, ...superPerformanceQuality };
}
function applyPresentationPreferences() {
  scene?.setMotion(prefs.motion);
  scene?.setTheme(false, true);
  scene?.setSuperPerformance(true);
  scene?.setQuality(effectiveRenderQuality());
  $("#stage").classList.toggle("reduce-motion", motionIsReduced());
  $("#stage").classList.toggle(
    "reduce-surfaces",
    !motionActive("surfaceTransitions"),
  );
  updateFooterClock(new Date(), motionActive("rollingNumbers"));
}
let previousLayout = "";
function fit() {
  const stage = $("#stage");
  const viewport = $("#viewport");
  const coarse = matchMedia("(pointer: coarse)").matches;
  const { width, height, scale, kind } = viewportLayout(
    viewport.clientWidth,
    viewport.clientHeight,
    coarse,
  );
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  stage.dataset.layout = kind;
  stage.dataset.touch = String(coarse);
  stage.style.setProperty("--stage-scale", String(scale));
  $("#viewport").style.setProperty("--scale", String(scale));
  const marks = document.querySelector("#inspection-marks");
  marks?.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const layoutKey = JSON.stringify([
    width,
    height,
    scale,
    kind,
    devicePixelRatio,
  ]);
  if (layoutKey !== previousLayout) {
    previousLayout = layoutKey;
    scene?.resize();
  }
}
window.addEventListener("resize", fit);
window.visualViewport?.addEventListener("resize", fit);
window.visualViewport?.addEventListener("scroll", fit);
matchMedia("(pointer: coarse)").addEventListener("change", fit);
fit();
let fileTicks: HTMLButtonElement[] = [];

function setMode(next: Mode) {
  const previousMode = mode;
  rollingTitles.forEach((title) =>
    title.update({
      animated: motionActive("rollingText") && next === "archive",
    }),
  );
  if (next !== "archive") {
    rollingTitles.forEach((title) => title.finish());
    hoverCode.finish();
    $("#hover-label").hidden = true;
  }
  mode = next;
  $("#stage").dataset.mode = next;
  $("#stage").style.setProperty("--detail-shade", String(next === "detail" ? 1 : scene?.detailVisibility ?? 0));
  if (previousMode !== next) fit();
  $("#archive-ui").inert = next !== "archive";
  $("#archive-ui").setAttribute("aria-hidden", String(next !== "archive"));
  if (next === "detail" && previousMode !== "detail") {
    // Text is ready in the same interaction, independently of the 3D motion.
    detailTransition.show(true);
  } else if (previousMode === "detail" && next !== "detail") {
    detailTransition.hide(!motionActive("surfaceTransitions"));
    $(".read-file").focus({ preventScroll: true });
  }
  $("#detail-ui").inert = next !== "detail";
  scene?.setMode(next);
  if (next === "detail" && previousMode !== "detail") {
    renderDetail();
    $("#detail-content").focus({ preventScroll: true });
  }
}
function select(index: number, navigation?: ArchiveNavigation) {
  selected = (index + records.length) % records.length;
  columnMemory[fileLocation(selected).lane] = selected;
  if (mode === "detail") setMode("archive");
  scene?.select(selected, navigation);
  updateSelection(navigation);
}
function stepFile(direction: number) {
  const files = columnFiles(fileLocation(selected).lane);
  if (files.length < 2) return;
  select(
    files[(files.indexOf(selected) + direction + files.length) % files.length],
    { axis: "row", direction },
  );
}
function stepColumn(direction: number) {
  if (archiveColumns.length < 2) return;
  const lane = fileLocation(selected).lane;
  const next = wrap(lane + direction, archiveColumns.length);
  select(columnMemory[next], { axis: "lane", direction });
}
function updateSelection(navigation?: ArchiveNavigation) {
  const r = records[selected];
  const { lane } = fileLocation(selected);
  const files = columnFiles(lane);
  selectionTitle.update({
    text: r.title,
    animated: motionActive("rollingText") && mode === "archive",
  });
  roleTitle.update({
    text: r.targetRole,
    animated: motionActive("rollingText") && mode === "archive",
  });
  categoryTitle.update({
    text: r.category,
    animated: motionActive("rollingText") && mode === "archive",
  });
  const direction =
    navigation && "axis" in navigation
      ? navigation.direction > 0
        ? "up"
        : "down"
      : "auto";
  selectedCode.update({
    value: Number(r.id.slice(2)),
    animated: motionActive("rollingNumbers") && mode === "archive",
    direction,
  });
  fileCounter.update({
    value: files.indexOf(selected) + 1,
    animated: motionActive("rollingNumbers") && mode === "archive",
    direction:
      navigation && "axis" in navigation && navigation.axis === "row"
        ? direction
        : "auto",
  });
  $(".count-total").textContent = String(files.length).padStart(2, "0");
  columnCounter.update({
    value: lane + 1,
    animated: motionActive("rollingNumbers") && mode === "archive",
    direction:
      navigation && "axis" in navigation && navigation.axis === "lane"
        ? direction
        : "auto",
  });
  columnTitle.update({
    text: archiveColumns[lane],
    animated: motionActive("rollingText") && mode === "archive",
  });
  $("#profile-owner").textContent = r.name;
  for (const action of ["column-prev", "column-next"])
    $<HTMLButtonElement>(`[data-action="${action}"]`).disabled = archiveColumns.length < 2;
  for (const action of ["prev", "next"])
    $<HTMLButtonElement>(`[data-action="${action}"]`).disabled = files.length < 2;
  if (fileTicks.length !== files.length) {
    $("#file-ticks").innerHTML = files.map(() => "<button></button>").join("");
    fileTicks = [...$("#file-ticks").querySelectorAll<HTMLButtonElement>("button")];
  }
  fileTicks.forEach((button, slot) => {
    const index = files[slot],
      record = records[index];
    button.dataset.select = String(index);
    button.setAttribute("aria-label", `选择档案 ${record.id} ${record.title}`);
    button.title = `${record.id} · ${record.title}`;
    button.classList.toggle("selected", index === selected);
    button.setAttribute("aria-pressed", String(index === selected));
    button.disabled = files.length < 2;
  });
}
function openFile() {
  if (!ready) return;
  setMode("detail");
}
function renderDetail() {
  const r = records[selected];
  $("#object-id").textContent = "NO." + String(selected + 1).padStart(3, "0");
  $("#detail-content").innerHTML = `
  <div class="detail-kicker"><span>FILE ${escapeHtml(r.id)}</span><span>${escapeHtml(r.category)}</span></div>
  <h2>${escapeHtml(r.en)}</h2><div class="detail-title-cn">${escapeHtml(r.title)}<span>${escapeHtml(r.category)}</span></div>
  <div class="detail-rule"></div>
  <dl class="profile-fields">
    <div><dt>姓名</dt><dd>${escapeHtml(r.name)}</dd></div>
    <div><dt>专业</dt><dd>${escapeHtml(r.major)}</dd></div>
    <div><dt>学校</dt><dd>${escapeHtml(r.school)}</dd></div>
    <div><dt>意向岗位</dt><dd>${escapeHtml(r.targetRole)}</dd></div>
  </dl>
  <div class="detail-actions"><a class="export-button" href="${assetUrl(`archives/RHINE-LAB-${r.id}.txt`)}" download="RHINE-LAB-${r.id}.txt" aria-label="导出 ${r.id} 档案">EXPORT <span>↓</span></a></div>
  <div class="detail-footnote"><span>${String(selected + 1).padStart(3, "0")} / ${String(records.length).padStart(3, "0")}</span></div>`;
  $("#detail-content").setAttribute("tabindex", "-1");
  $("#detail-content").inert = false;
  $("#detail-content").scrollTop = 0;
}
function notify(message: string) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
}

document.addEventListener("click", (e) => {
  if (!started) return;
  const el = (e.target as Element).closest<HTMLElement>("button");
  if (!el) return;
  if (el.dataset.select) {
    select(Number(el.dataset.select));
    return;
  }
  const action = el.dataset.action;
  if (action === "prev") stepFile(-1);
  if (action === "next") stepFile(1);
  if (action === "column-prev") stepColumn(-1);
  if (action === "column-next") stepColumn(1);
  if (action === "open") openFile();
  if (action === "back") {
    setMode("archive");
  }
});
document.addEventListener("keydown", (e) => {
  if (!started) return;
  const typing = e.target instanceof HTMLInputElement;
  if (e.key === "Escape") {
    if (mode === "detail") {
      setMode("archive");
    }
    return;
  }
  if (typing || !ready || mode !== "archive") return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    stepColumn(-1);
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    stepColumn(1);
  }
  if (["ArrowUp", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    stepFile(e.key === "ArrowUp" ? -1 : 1);
  }
  if (
    e.key === "Enter" &&
    (document.activeElement === document.body ||
      document.activeElement?.id === "detail-content" ||
      ["prev", "next", "column-prev", "column-next"].includes(
        (document.activeElement as HTMLElement)?.dataset.action ?? "",
      ) ||
      (document.activeElement as HTMLElement)?.dataset.select)
  ) {
    e.preventDefault();
    if (mode === "archive") openFile();
  }
});

const inspectionOverlay = new InspectionOverlay();

let lastTime = 0,
  frameCount = 0,
  frameStart = performance.now(),
  fps = 0;
function frame(ms: number) {
  if (document.hidden) {
    requestAnimationFrame(frame);
    return;
  }
  const time = ms / 1000;
  scene?.update(time);
  $("#stage").style.setProperty(
    "--detail-shade",
    String(mode === "detail" ? 1 : scene?.detailVisibility ?? 0),
  );
  const currentScene = scene;
  if (currentScene)
    inspectionOverlay.render(
      currentScene.decryptionFrame,
      (x, y) => currentScene.projectCard(x, y),
      false,
      motionActive("modelDecryption"),
    );
  if (Math.floor(time) !== lastTime) {
    lastTime = Math.floor(time);
    updateFooterClock(new Date(), motionActive("rollingNumbers"));
  }
  frameCount++;
  if (ms - frameStart > 1000) {
    fps = (frameCount * 1000) / (ms - frameStart);
    frameStart = ms;
    frameCount = 0;
    $("#three-scene").dataset.fps = String(Math.round(fps));
    $("#three-scene").dataset.renderStats = JSON.stringify(
      scene?.getStats() ?? { loaded: false, drawCalls: 0, triangles: 0 },
    );
  }
  requestAnimationFrame(frame);
}
function bindScene(scene: ArchiveScene, cell?: { lane: number; row: number }) {
  scene.select(selected, cell ? { cell } : undefined);
  scene.onSelect = (i, cell) => {
    if (mode !== "archive") return;
    select(i, cell ? { cell } : undefined);
  };
  scene.onNavigate = (axis, direction) => {
    if (mode !== "archive") return;
    if (axis === "lane") stepColumn(direction);
    else stepFile(direction);
  };
  scene.onHover = (i) => {
    const label = $("#hover-label");
    if (i === null) {
      label.hidden = true;
      hoverCode.finish();
      hoverTitle.finish();
      return;
    }
    const animated = motionActive("rollingText") && mode === "archive";
    const numbersAnimated =
      motionActive("rollingNumbers") && mode === "archive";
    hoverCode.update({
      value: Number(records[i].id.slice(2)),
      animated: !label.hidden && numbersAnimated,
    });
    hoverTitle.update({
      text: records[i].title,
      animated: !label.hidden && animated,
    });
    label.hidden = false;
    // Prepare the first visible value so the next hover can animate immediately.
    hoverCode.update({ animated: numbersAnimated });
    hoverTitle.update({ animated });
  };
}
async function start() {
  try {
    scene = new ArchiveScene(
      $("#three-scene"),
      undefined,
      false,
      "baseline",
      true,
    );
    applyPresentationPreferences();
    await Promise.all([
      scene.load(),
      document.fonts.load(
        "400 20px MiSans",
        `个人信息档案姓名专业学校意向岗位：0123456789 ${records[0].name}`,
      ),
    ]);
    bindScene(scene);
    ready = true;
    // No opening timeline or user-activation gate: the first rendered frame
    // already contains the complete archive array.
    setMode("archive");
    scene.revealImmediately();
    started = true;
    updateSelection();
    scene.update(performance.now() / 1000);
    $("#stage").inert = false;
    loading.remove();
    requestAnimationFrame(frame);
    setTimeout(() => void initPwa(notify), 1500);
  } catch (error) {
    scene?.dispose();
    scene = undefined;
    console.error(error);
    loading.innerHTML =
      '<div class="error-state"><strong>资料库暂时无法载入</strong><p>请确认浏览器已启用硬件加速，然后重试。</p><button type="button" data-action="retry-load">重新加载 →</button></div>';
    loading
      .querySelector("button")
      ?.addEventListener("click", () => location.reload());
  }
}
updateSelection();
void start();
enableGamepad();
const ARCHIVE_HINT: Record<"keyboard" | "gamepad", string> = {
  keyboard: records.length === 1
    ? `<kbd>ENTER</kbd> 读取档案`
    : `<kbd>←</kbd> <kbd>→</kbd> 切换分类 <span>／</span> <kbd>↑</kbd> <kbd>↓</kbd> 前后档案 <span>／</span> <kbd>ENTER</kbd> 读取`,
  gamepad: records.length === 1
    ? `<kbd>A</kbd> 读取档案`
    : `<kbd>LS</kbd> <kbd>DP</kbd> 切换分类 / 前后档案 <span>／</span> <kbd>A</kbd> 读取`,
};
onInputDevice((device) => {
  const hint = document.querySelector(".archive-hint");
  if (hint) hint.innerHTML = ARCHIVE_HINT[device];
});
// Read-only diagnostics and archive navigation for local verification.
Object.assign(window, {
  rhine: {
    archive: () => setMode("archive"),
    detail: () => openFile(),
    select: (i: number) => select(i),
    stats: () => ({
      ...scene?.getStats(),
      threeState: scene ? "on" : "off",
      fps: Math.round(fps),
      mode,
      ready,
      startup: started ? "started" : "loading",
      motion: { reduced: motionIsReduced(), preset: prefs.motionPreset },
      superPerformance: true,
      baseQuality: "original",
      rendering: effectiveRenderQuality(),
      selected: records[selected].id,
      recordCount: records.length,
      categoryCount: archiveColumns.length,
    }),
  },
});
if (import.meta.hot) import.meta.hot.dispose(() => scene?.dispose());
