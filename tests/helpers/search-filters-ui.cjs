const assert = require("node:assert/strict");
const path = require("node:path");
const { copy } = require("./chrome-fixture.cjs");

module.exports = async function verifySearchFiltersUI({ page, fixture, artifacts }) {
  await page.locator('.ba-filter-panel > summary').click();
  let checks = 0;
  const equal = (...args) => { assert.equal(...args); checks += 1; };
  const deepEqual = (...args) => { assert.deepEqual(...args); checks += 1; };
  const originalRoot = copy(fixture.root);
  const originalStorage = copy(fixture.storage);
  const mutations = fixture.mutations.length;
  const openedTabs = fixture.tabsCreated.length;
  const openedWindows = fixture.windowsCreated.length;
  const rows = page.locator(".ba-bookmark-list .ba-bookmark-row");
  const search = page.locator(".ba-search");
  const domain = page.getByRole("combobox", { name: "Domain", exact: true });
  const duplicates = page.getByRole("checkbox", { name: "Duplicates only", exact: true });
  const chips = page.getByRole("group", { name: "Active filters", exact: true });
  const scope = page.locator(".ba-search-scope");
  const shown = async () => (await rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.bookmarkId))).sort();
  const selected = () => rows.filter({ has: page.locator(".ba-select-bookmark:checked") }).count();
  const clear = () => page.getByRole("button", { name: "Clear all filters", exact: true }).click();
  const refresh = async () => {
    const before = await page.evaluate(() => globalThis.__managerReplies);
    await page.evaluate(() => globalThis.__bookmarkChange());
    await page.waitForFunction((old) => globalThis.__managerReplies > old, before);
  };
  const seed = [
    ["a", "Needle duplicate", "https://EXAMPLE.test:443/shared#one", Date.now()],
    ["b", "Other duplicate", "https://example.test/shared#two"],
    ["sub", "Subdomain", "https://sub.example.test/shared"],
    ["query", "Different query", "https://example.test/shared?q=1"],
    ["path", "Different path", "https://example.test/shared/"],
    ["invalid", "Invalid URL", "not a URL"],
    ["script", "Script URL", "javascript:alert('https://fake.test')"],
    ["file", "Local URL", "file:///tmp/example.test"],
    ["credentials", "Credentials URL", "https://example.test:secret@actual.test:8443/path"],
    ["ipv6", "IPv6 URL", "https://[::1]:8443/path"],
    ["idn", "IDN URL", "https://b\u00fccher.test/path"],
    ["cross", "Research copy", "https://example.test/201#copy"],
    ["managed", "Managed copy", "https://example.test/401#copy"]
  ].map(([id, title, url, dateAdded = Date.UTC(2020, 0, 1)]) => ({
    id: `filter-${id}`, parentId: "101", title, url, dateAdded
  }));
  fixture.find("101").children.push(...seed);
  await refresh();
  equal(await rows.count(), 15);
  equal(await scope.innerText(), "Search scope: Library (including subfolders)");
  equal(await search.getAttribute("aria-describedby"), "ba-search-scope");
  deepEqual(await domain.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value)),
    ["", "[::1]", "actual.test", "example.test", "sub.example.test", "xn--bcher-kva.test"]);
  await page.locator(".ba-select-all").check();
  await domain.selectOption("example.test");
  equal(await rows.count(), 8);
  equal(await selected(), 8);
  equal((await shown()).includes("filter-sub"), false);
  equal((await shown()).includes("filter-credentials"), false);
  await domain.selectOption("actual.test");
  deepEqual(await shown(), ["filter-credentials"]);
  equal(await selected(), 0);
  await domain.selectOption("[::1]");
  deepEqual(await shown(), ["filter-ipv6"]);
  await domain.selectOption("xn--bcher-kva.test");
  deepEqual(await shown(), ["filter-idn"]);
  await clear();
  equal(await chips.isVisible(), false);
  equal(await search.evaluate((node) => node === document.activeElement), true);

  await page.locator(".ba-select-all").check();
  await duplicates.check();
  deepEqual(await shown(), ["201", "filter-a", "filter-b", "filter-cross"]);
  equal(await selected(), 4);
  await search.fill("Needle");
  deepEqual(await shown(), ["filter-a"]);
  equal(await selected(), 1);
  await page.locator(".ba-date-filter").selectOption("today");
  deepEqual(await shown(), ["filter-a"]);
  await page.locator(".ba-issue-filter").selectOption("unchecked");
  await domain.selectOption("example.test");
  equal(await chips.locator(".ba-filter-chip").count(), 5);
  equal(await domain.locator("option").count(), 6);
  await page.screenshot({ path: path.join(artifacts, "filters-desktop.png"), animations: "disabled" });
  for (const [width, height] of [[390, 844], [320, 844], [390, 600]]) {
    await page.setViewportSize({ width, height });
    equal(await page.locator(".ba-folder-tree").evaluate((node) => node.clientHeight >= 96), true);
    await rows.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, `filters-${width}-${height}.png`), animations: "disabled" });
    equal(await page.locator(".ba-toolbar").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    equal(await chips.evaluate((node) => [...node.children].every((child) => child.scrollWidth <= child.clientWidth + 1)), true);
    equal(await page.locator(".ba-bookmark-list").evaluate((node) => node.clientHeight > 40), true);
    const framing = await rows.first().evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const layout = node.closest(".ba-layout").getBoundingClientRect();
      return { row: rect.toJSON(), layout: layout.toJSON() };
    });
    equal(framing.row.top >= framing.layout.top - 1 && framing.row.bottom <= framing.layout.bottom + 1, true, JSON.stringify(framing));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const removeSearch = page.getByRole("button", { name: "Remove Search: Needle", exact: true });
  await removeSearch.focus();
  await page.keyboard.press("Enter");
  equal(await search.inputValue(), "");
  equal(await search.evaluate((node) => node === document.activeElement), true);
  for (const [name, control, value] of [
    ["Added today", page.locator(".ba-date-filter"), "all"],
    ["Unchecked", page.locator(".ba-issue-filter"), "all"],
    ["Domain: example.test", domain, ""]
  ]) {
    await page.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
    equal(await control.inputValue(), value);
    equal(await control.evaluate((node) => node === document.activeElement), true);
  }
  await page.getByRole("button", { name: "Remove Duplicates only", exact: true }).focus();
  await page.keyboard.press("Space");
  equal(await duplicates.isChecked(), false);
  equal(await duplicates.evaluate((node) => node === document.activeElement), true);
  equal(await rows.count(), 15);
  equal(await selected(), 1);
  await page.locator(".ba-issue-filter").selectOption("issues");
  equal(await selected(), 0);
  await clear();
  equal(await selected(), 0);

  await duplicates.check();
  await page.locator('[data-folder-id="101"] .ba-name').click();
  deepEqual(await shown(), ["filter-a", "filter-b"]);
  equal(await scope.innerText(), "Search scope: Library / All (including subfolders)");
  await domain.selectOption("sub.example.test");
  equal(await rows.count(), 0);
  equal(await page.locator(".ba-bookmark-list .ba-detail-empty").innerText().then((text) => text.includes("No bookmarks match")), true);
  await page.locator('[data-folder-id="102"] .ba-name').click();
  equal(await domain.inputValue(), "");
  equal(await chips.locator('[data-remove-filter="domainFilter"]').count(), 0);
  equal(await duplicates.isChecked(), true);
  equal(await rows.count(), 0);
  await clear();
  deepEqual(await shown(), ["201"]);
  await page.getByRole("button", { name: /^All in Library/ }).click();
  await domain.selectOption("actual.test");
  await page.getByRole("tab", { name: /^Saved Windows/ }).click();
  equal(await domain.inputValue(), "");
  equal(await rows.count(), 3);
  equal(await scope.innerText(), "Search scope: Saved Windows (including subfolders)");
  await duplicates.check();
  equal(await rows.count(), 0);
  await page.getByRole("tab", { name: /^All Bookmarks/ }).click();
  deepEqual(await shown(), ["201", "401", "filter-a", "filter-b", "filter-cross", "filter-managed"]);
  await page.locator('[data-bookmark-id="401"] .ba-select-bookmark').check();
  for (const action of ["move", "rename", "delete"]) {
    equal(await page.locator(`.ba-selection-bar [data-bulk-action="${action}"]`).isDisabled(), true);
  }
  await search.fill("Needle");
  equal(await selected(), 0);
  await clear();
  equal(await selected(), 0);
  equal(fixture.mutations.length, mutations);
  equal(fixture.tabsCreated.length, openedTabs);
  equal(fixture.windowsCreated.length, openedWindows);
  deepEqual(fixture.storage.settings, originalStorage.settings);
  deepEqual(fixture.storage.metadataByUrl, originalStorage.metadataByUrl);
  await page.getByRole("tab", { name: /^Library/ }).click();
  await domain.selectOption("actual.test");
  fixture.find("101").children = fixture.find("101").children.filter((node) => node.id !== "filter-credentials");
  await refresh();
  equal(await domain.inputValue(), "");
  equal(await chips.isVisible(), false);
  await search.fill("https://example.test/" + "very-long-search-".repeat(30));
  await page.setViewportSize({ width: 320, height: 844 });
  equal(await chips.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  equal(await page.locator(".ba-layout").evaluate((node) => node.getBoundingClientRect().height > 200), true);
  await clear();
  await page.setViewportSize({ width: 1440, height: 1000 });

  fixture.root.children = originalRoot.children;
  for (const key of Object.keys(fixture.storage)) delete fixture.storage[key];
  Object.assign(fixture.storage, originalStorage);
  await page.reload();
  await page.getByRole('tab', { name: /^Library/ }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ba-bookmark-list .ba-bookmark-row").length === 2);
  return checks;
};
