import { addClip, removeClip, updateClip } from "./clip-core.js";
import { validateMessage } from "./message-core.js";
import { createSequentialRepository } from "./storage-core.js";

const MENU_ID = "tracepin-save-selection";
const STORAGE_KEY = "clips";

const repository = createSequentialRepository({
  async read() { const result = await chrome.storage.local.get(STORAGE_KEY); return result[STORAGE_KEY] ?? []; },
  async write(next) { await chrome.storage.local.set({ [STORAGE_KEY]: next }); }
});

async function savePin(input) {
  return repository.mutate((existing) => {
    const result = addClip(existing, input);
    return { next: result.clips, value: result };
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: MENU_ID, title: "Добавить правку в TracePin", contexts: ["selection"] }));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText || !tab?.url) return;
  try {
    const result = await savePin({ quote: info.selectionText, url: tab.url, title: tab.title ?? "", tags: [], type: "text", priority: "normal", viewport: { width: tab.width, height: tab.height } });
    await chrome.action.setBadgeText({ text: result.created ? "1" : "=" });
    await chrome.action.setBadgeBackgroundColor({ color: "#536f84" });
  } catch {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#8b5d42" });
  }
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  (async () => {
    if (sender.id !== chrome.runtime.id) throw new Error("untrusted_sender");
    const message = validateMessage(rawMessage);
    if (message.type === "GET_STATE") return { clips: await repository.read() };
    if (message.type === "SAVE_PIN") {
      if (sender.tab?.url && new URL(message.input.url).origin !== new URL(sender.tab.url).origin) throw new Error("source_mismatch");
      return savePin(message.input);
    }
    if (message.type === "UPDATE_PIN") {
      const clips = await repository.mutate((existing) => { const next = updateClip(existing, message.id, message.patch ?? {}); return { next, value: next }; });
      return { clips };
    }
    if (message.type === "REMOVE_PIN") {
      const clips = await repository.mutate((existing) => { const next = removeClip(existing, message.id); return { next, value: next }; });
      return { clips };
    }
    if (message.type === "CLEAR_ALL") {
      await repository.mutate(() => ({ next: [], value: [] }));
      return { clips: [] };
    }
    if (message.type === "START_PICKER") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:/u.test(tab.url ?? "")) throw new Error("page_unavailable");
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker.js"] });
      return { started: true };
    }
    throw new Error("unknown_message");
  })().then((value) => sendResponse({ ok: true, ...value })).catch((error) => sendResponse({ ok: false, error: error.message || "request_failed" }));
  return true;
});
