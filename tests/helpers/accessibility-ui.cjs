const assert = require("node:assert/strict");
const path = require("node:path");
const { copy } = require("./chrome-fixture.cjs");

module.exports = async function verifyAccessibilityUI({ page, fixture, artifacts }) {
  let checks = 0;
  const equal = (...args) => { assert.equal(...args); checks += 1; };
  const originalRoot = copy(fixture.root);
  const originalStorage = copy(fixture.storage);
  const openedTabs = fixture.tabsCreated.length;
  equal(await page.locator(".ba-window").getAttribute("aria-modal"), "true");
  await page.locator(".ba-close").focus();
  await page.keyboard.press("Shift+Tab");
  equal(await page.evaluate(() => document.querySelector(".ba-window").contains(document.activeElement)), true);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "outside-focus-probe";
    document.body.append(button);
    button.focus();
  });
  equal(await page.locator(".ba-search").evaluate((node) => node === document.activeElement), true);
  await page.evaluate(() => document.getElementById("outside-focus-probe").remove());
  await page.keyboard.press("Tab");
  equal(await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return style.outlineStyle === "solid" && parseFloat(style.outlineWidth) >= 2;
  }), true);

  await page.getByRole("tab", { name: /^All Bookmarks/ }).click();
  const warning = page.locator('.ba-bookmark-list [data-bookmark-id="200"] .ba-row-status');
  const dead = page.locator('.ba-bookmark-list [data-bookmark-id="210"] .ba-row-status');
  equal(await warning.innerText(), "!");
  equal(await dead.innerText(), "\u00d7");
  equal(await warning.getAttribute("aria-label").then((value) => value.startsWith("Link warning:")), true);
  equal(await dead.getAttribute("aria-label").then((value) => value.startsWith("Broken link:")), true);
  equal(await warning.locator(".ba-status-symbol").evaluate((node) => getComputedStyle(node).clipPath.startsWith("polygon")), true);
  equal(await dead.locator(".ba-status-symbol").evaluate((node) => getComputedStyle(node).borderRadius), "50%");
  const contrasts = await page.evaluate(() => {
    const parse = (color) => color.match(/[\d.]+/g).map(Number);
    const blend = (top, bottom) => top.slice(0, 3).map((value, index) => value * (top[3] ?? 1) + bottom[index] * (1 - (top[3] ?? 1)));
    const luminance = (color) => color.slice(0, 3).map((value) => {
      value /= 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return [".ba-current", ".ba-status", ".ba-bookmark-title", ".ba-bookmark-sub .ba-muted", ".ba-row-status[data-state=warning] .ba-status-symbol", ".ba-row-status[data-state=dead] .ba-status-symbol", ".ba-search"].map((selector) => {
      const node = document.querySelector(selector);
      const ancestors = [];
      for (let current = node; current; current = current.parentElement) ancestors.unshift(current);
      const background = ancestors.reduce((color, current) => blend(parse(getComputedStyle(current).backgroundColor), color), [255, 255, 255]);
      const foreground = parse(getComputedStyle(node, selector === ".ba-search" ? "::placeholder" : null).color);
      const a = luminance(foreground);
      const b = luminance(background);
      return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  });
  for (const sample of contrasts) equal(sample.ratio >= 4.5, true, JSON.stringify(sample));
  await page.screenshot({ path: path.join(artifacts, "accessibility-status-desktop.png"), animations: "disabled" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  equal(await page.locator(".ba-window").evaluate((node) => getComputedStyle(node).animationName), "none");
  equal(await page.locator(".ba-close").evaluate((node) => getComputedStyle(node).transitionDuration), "0s");
  await page.emulateMedia({ forcedColors: "active" });
  await page.locator(".ba-close").focus();
  await page.keyboard.press("Tab");
  equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "solid");
  await page.emulateMedia({ forcedColors: "none" });

  let parent = fixture.find("2");
  for (let depth = 0; depth < 7; depth += 1) {
    const child = { id: `accessibility-deep-${depth}`, parentId: parent.id, title: `Destination ${depth} ` + "long-path-name-".repeat(15), index: parent.children.length, children: [] };
    parent.children.push(child);
    parent = child;
  }
  await page.reload();
  await page.locator('.ba-bookmark-list [data-bookmark-id="200"]').waitFor();
  await page.locator('.ba-bookmark-list [data-bookmark-id="200"] .ba-icon-btn').click();
  equal(await page.locator('.ba-bookmark-list [data-bookmark-id="200"] .ba-icon-btn').getAttribute("aria-expanded"), "true");
  await page.locator(".ba-menu").getByRole("button", { name: "Move", exact: true }).click();
  const dialog = page.locator(".ba-action-dialog");
  await dialog.getByRole("combobox", { name: "Destination folder", exact: true }).selectOption(parent.id);
  for (const [width, height] of [[390, 844], [320, 568], [800, 600]]) {
    await page.setViewportSize({ width, height });
    equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    equal(await dialog.locator(".ba-action-buttons").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
    }), true);
    equal(await dialog.locator(".ba-action-body").evaluate((node) => node.scrollHeight > node.clientHeight), true);
    await page.screenshot({ path: path.join(artifacts, `accessible-dialog-${width}-${height}.png`), animations: "disabled" });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("Tab");
    equal(await dialog.getByRole("button", { name: "Move", exact: true }).evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press("Tab");
    equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true);
  }
  await page.keyboard.press("Escape");
  equal(await dialog.count(), 0);
  equal(fixture.find("200").parentId, "101");
  equal(fixture.tabsCreated.length, openedTabs);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('.ba-bookmark-list [data-bookmark-id="200"] .ba-icon-btn').focus();
  await page.keyboard.press("Enter");
  equal(await page.locator(".ba-menu").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
  }), true);
  await page.keyboard.press("End");
  equal(await page.evaluate(() => document.activeElement.textContent), "Delete");
  await page.keyboard.press("Escape");
  equal(await page.locator('.ba-bookmark-list [data-bookmark-id="200"] .ba-icon-btn').getAttribute("aria-expanded"), "false");
  fixture.root.children = originalRoot.children;
  for (const key of Object.keys(fixture.storage)) delete fixture.storage[key];
  Object.assign(fixture.storage, originalStorage);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".ba-bookmark-list .ba-bookmark-row").length === 2);
  return checks;
};
