const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, after, beforeEach, test } = require("node:test");
const { chromium } = require(process.env.BOOKMARK_TEST_PLAYWRIGHT || "playwright");

// Synthetic data only: installed Chrome uses Playwright's temporary profile.
const artifacts = process.env.BOOKMARK_TEST_ARTIFACTS ||
  fs.mkdtempSync(path.join(require("node:os").tmpdir(), "bookmark-popup-a11y-"));
const popupUrl = pathToFileURL(path.resolve(__dirname, "..", "popup.html")).href;
const controls = ["saveFolder", "saveToFolder", "saveToAll", "createFolderMini", "saveAllWindows", "openManager"];
let browser;
let context;
let page;
let errors;

before(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  console.log(`Installed Chrome ${browser.version()}; isolated temporary profile`);
});

beforeEach(async () => {
  if (context) await context.close();
  errors = [];
  context = await browser.newContext({ viewport: { width: 360, height: 600 }, reducedMotion: "no-preference" });
  await context.addInitScript(() => {
    const longTitle = "Synthetic bookmark title ".repeat(30) + "UnbrokenTitle".repeat(30);
    const longFolder = "Synthetic collection / ".repeat(25);
    globalThis.__popupMessages = [];
    Object.assign(globalThis.chrome || (globalThis.chrome = {}), {
      runtime: {
        sendMessage(message, reply) {
          globalThis.__popupMessages.push(message.type);
          const respond = (result) => queueMicrotask(() => reply({ ok: true, result }));
          switch (message.type) {
            case "getState":
              respond({ settings: {}, defaultFolder: { id: "all" }, managedRoot: { id: "root" },
                folders: [{ id: "all", title: longFolder, depth: 1 }] });
              break;
            case "getCurrentTab":
              respond({ title: longTitle, url: location.search.includes("unsupported") ? "chrome://settings" : "https://example.test/" });
              break;
            case "saveAllWindows":
              globalThis.__finishWindows = () => respond({ savedTabCount: 4, skippedTabCount: 1,
                folders: [{ title: longTitle }], failedTabCount: 0, failedWindowCount: 0 });
              break;
            default:
              throw new Error(`Unexpected synthetic request: ${message.type}`);
          }
        }
      }
    });
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(popupUrl);
  await page.waitForFunction(() => document.querySelector("#saveFolder").options.length === 1);
});

after(async () => {
  if (context) await context.close();
  if (browser) await browser.close();
});

function luminance(rgb) {
  return rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function paint(selector) {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(["backgroundColor", "backgroundImage", "color", "borderColor", "boxShadow", "transform", "cursor"]
      .map((key) => [key, style[key]]));
  });
}

async function settle() {
  // Wait past the real stylesheet's 140ms transitions when inspecting paint.
  await page.waitForTimeout(180);
}

async function assertLayout() {
  const result = await page.evaluate(() => {
    const shell = document.querySelector(".mini-shell").getBoundingClientRect();
    const elements = [...document.querySelectorAll("button, select, h1, .brand-mark, .window-save-status:not([hidden])")];
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      outside: elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > shell.bottom;
      }).map((element) => element.id || element.className || element.tagName),
      clippedLabels: [...document.querySelectorAll("button")].filter((element) =>
        element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight).map((element) => element.id),
      shellHeight: shell.height
    };
  });
  assert.equal(result.overflow, false, "no horizontal page overflow");
  assert.deepEqual(result.outside, [], "content stays inside the popup");
  assert.deepEqual(result.clippedLabels, [], "button labels are not clipped");
  assert.ok(result.shellHeight <= 600, "popup remains compact");
}

test("real popup initializes with synthetic Chrome runtime and loaded assets", async () => {
  assert.deepEqual(await page.evaluate(() => globalThis.__popupMessages), ["getState", "getCurrentTab"]);
  assert.equal(await page.locator("button").count(), 5);
  assert.equal(await page.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
  assert.deepEqual(errors, []);
});

test("Tab reaches every enabled control in document order with visible outlines", async () => {
  for (const id of controls) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      return { id: element.id, visible: element.matches(":focus-visible"), style: style.outlineStyle,
        width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset),
        contained: rect.left >= extent && rect.right + extent <= innerWidth && rect.top >= extent && rect.bottom + extent <= innerHeight };
    });
    assert.equal(focus.id, id);
    assert.equal(focus.visible, true, id);
    assert.equal(focus.style, "solid", id);
    assert.ok(focus.width >= 3 && focus.offset >= 2, id);
    assert.equal(focus.contained, true, `${id} outline is not clipped`);
  }
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "saveAllWindows");
});

test("focus indicator contrasts at least 3:1 against adjacent surfaces", async () => {
  await page.keyboard.press("Tab");
  const colors = await page.locator("#saveFolder").evaluate((element) => {
    const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    return [getComputedStyle(element).outlineColor, getComputedStyle(element).backgroundColor,
      getComputedStyle(document.querySelector(".mini-shell")).backgroundColor].map(rgb);
  });
  assert.ok(contrast(colors[0], colors[1]) >= 3);
  assert.ok(contrast(colors[0], colors[2]) >= 3);
});

test("disabled controls have distinct feedback without hover or pressed styling", async () => {
  for (const id of controls) {
    const selector = `#${id}`;
    await page.mouse.move(0, 590);
    const enabled = await paint(selector);
    await page.locator(selector).evaluate((element) => { element.disabled = true; });
    await settle();
    const disabled = await paint(selector);
    assert.notEqual(disabled.backgroundColor, enabled.backgroundColor, id);
    assert.equal(disabled.cursor, "not-allowed", id);
    assert.equal(disabled.transform, "none", id);
    assert.equal(disabled.boxShadow, "none", id);
    await page.locator(selector).hover();
    await settle();
    assert.deepEqual(await paint(selector), disabled, `${id} disabled hover`);
    await page.mouse.down();
    try {
      await settle();
      assert.deepEqual(await paint(selector), disabled, `${id} disabled press`);
    } finally {
      await page.mouse.up();
    }
  }
  assert.deepEqual(await page.evaluate(() => globalThis.__popupMessages), ["getState", "getCurrentTab"]);
});

test("unsupported pages disable save actions and keyboard navigation skips them", async () => {
  await page.goto(`${popupUrl}?unsupported`);
  await page.waitForFunction(() => document.querySelector("#saveToFolder").disabled);
  assert.equal(await page.locator("#saveToAll").isDisabled(), true);
  assert.equal(await page.locator("#currentPageMini").textContent(), "This Chrome page cannot be saved.");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "saveFolder");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "createFolderMini");
});

test("pending window save stays visually disabled and long result status stays contained", async () => {
  const button = page.locator("#saveAllWindows");
  await button.click();
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.innerText(), "Saving windows...");
  await settle();
  const disabled = await paint("#saveAllWindows");
  assert.equal(disabled.cursor, "not-allowed");
  assert.equal(disabled.transform, "none");
  assert.equal(disabled.boxShadow, "none");
  await page.evaluate(() => globalThis.__finishWindows());
  await page.waitForFunction(() => !document.querySelector("#saveAllWindows").disabled);
  assert.equal(await page.locator("#windowSaveStatus").isVisible(), true);
  const status = await page.locator("#windowSaveStatus").evaluate((element) => ({
    height: element.clientHeight, scrollable: element.scrollHeight > element.clientHeight,
    overflow: getComputedStyle(element).overflowY
  }));
  assert.ok(status.height <= 100 && status.scrollable);
  assert.equal(status.overflow, "auto");
  await assertLayout();
});

test("white primary text meets 4.5:1 across the full gradient and interaction states", async () => {
  const ratios = [];
  const check = async (state) => {
    const colors = await page.locator("#saveToFolder").evaluate((element) => {
      const style = getComputedStyle(element);
      const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const stops = style.backgroundImage.match(/rgba?\([^)]+\)/g);
      return { text: rgb(style.color), backgrounds: stops ? stops.map(rgb) : [rgb(style.backgroundColor)] };
    });
    assert.deepEqual(colors.text, [255, 255, 255], state);
    // Sample interpolation as well as the gradient endpoints.
    const first = colors.backgrounds[0];
    const last = colors.backgrounds.at(-1);
    for (let step = 0; step <= 100; step++) {
      const background = first.map((value, i) => value + (last[i] - value) * step / 100);
      const ratio = contrast(colors.text, background);
      assert.ok(ratio >= 4.5, `${state}: ${ratio.toFixed(2)}:1`);
      ratios.push(ratio);
    }
  };
  await check("normal");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await check("keyboard focus");
  await page.locator("#saveToFolder").hover();
  await settle();
  await check("hover");
  await page.mouse.down();
  try {
    await settle();
    await check("pressed");
  } finally {
    await page.mouse.move(0, 590);
    await page.mouse.up();
  }
  console.log(`Minimum primary contrast: ${Math.min(...ratios).toFixed(2)}:1`);
});

test("reduced motion removes transitions, animations and hover movement", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
  for (const id of controls) {
    const motion = await page.locator(`#${id}`).evaluate((element) => {
      const style = getComputedStyle(element);
      return { transition: style.transitionDuration, animation: style.animationName };
    });
    assert.equal(motion.transition, "0s", id);
    assert.equal(motion.animation, "none", id);
    await page.locator(`#${id}`).hover();
    assert.equal((await paint(`#${id}`)).transform, "none", id);
  }
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#saveFolder").evaluate((element) => getComputedStyle(element).outlineWidth), "3px");
});

test("long page and folder titles preserve compact layout without control clipping", async () => {
  const title = await page.locator("#currentPageMini").evaluate((element) => ({
    length: element.textContent.length, ellipsis: getComputedStyle(element).textOverflow,
    overflowing: element.scrollWidth > element.clientWidth, tooltip: element.title
  }));
  assert.ok(title.length > 500 && title.overflowing);
  assert.equal(title.ellipsis, "ellipsis");
  assert.equal(title.tooltip, "https://example.test/");
  assert.ok((await page.locator("#saveFolder option").textContent()).length > 500);
  await assertLayout();
  assert.deepEqual(errors, []);
});

test("normal and reduced-motion screenshots render real popup without decorative blobs", async () => {
  const backgrounds = await page.locator("body, .mini-shell, .brand-mark").evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).backgroundImage));
  assert.equal(backgrounds[0], "none");
  assert.ok(backgrounds[1].includes("linear-gradient"));
  assert.ok(backgrounds[2].includes("linear-gradient"));
  for (const [motion, filename] of [["no-preference", "popup-normal.png"], ["reduce", "popup-reduced.png"]]) {
    await page.emulateMedia({ reducedMotion: motion });
    await page.locator("#saveFolder").focus();
    await assertLayout();
    await page.locator(".mini-shell").screenshot({ path: path.join(artifacts, filename) });
  }
  assert.deepEqual(errors, []);
  console.log(`Popup screenshots: ${artifacts}`);
});

test("popup retains intrinsic width from a narrow bootstrap viewport", async () => {
  await page.setViewportSize({ width: 180, height: 600 });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#saveToFolder").disabled);
  const size = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.getBoundingClientRect().width,
    shellWidth: document.querySelector(".mini-shell").getBoundingClientRect().width,
    headingHeight: document.querySelector("h1").getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(document.querySelector("h1")).lineHeight)
  }));
  assert.equal(size.bodyWidth, 360);
  assert.equal(size.shellWidth, 360);
  assert.equal(size.documentWidth, 360);
  assert.ok(size.headingHeight <= size.lineHeight + 1, "heading stays on one line");
  // Simulate the popup host adopting the document's intrinsic size, not a tab layout.
  await page.setViewportSize({ width: size.documentWidth, height: 600 });
  await assertLayout();
  for (const id of ["saveToFolder", "saveToAll", "createFolderMini"]) {
    assert.ok(await page.locator(`#${id}`).evaluate((node) => node.clientWidth >= 68), id);
  }
  await page.screenshot({ path: path.join(artifacts, "popup-bootstrap-width.png") });
});
