import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../extension");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));

test("Manifest V3 использует минимальные разрешения без host access", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "contextMenus", "scripting", "storage"]);
  assert.equal("host_permissions" in manifest, false);
  assert.equal(manifest.incognito, "not_allowed");
});

test("все точки входа расширения существуют локально", () => {
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, "picker.js", "clip-core.js", "message-core.js", "storage-core.js"]) assert.equal(existsSync(resolve(root, file)), true, file);
});

test("CSP запрещает удалённый и eval-код", () => {
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'");
});
