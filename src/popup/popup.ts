import {
  DEFAULT_CRYPTO_KEYWORDS,
  DEFAULT_SLOP_KEYWORDS,
} from "../shared/defaults";
import {
  clearVerdictCache,
  loadSettings,
  loadStats,
  parseHandleList,
  parseKeywordList,
  saveSettings,
} from "../shared/settings";
import type { Settings } from "../shared/types";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

function listToText(items: string[]): string {
  return items.join("\n");
}

function readForm(): Settings {
  return {
    enabled: ($("enabled") as HTMLInputElement).checked,
    passthrough: ($("passthrough") as HTMLInputElement).checked,
    hideNoTextImage: ($("hideNoTextImage") as HTMLInputElement).checked,
    hideNoTextGif: ($("hideNoTextGif") as HTMLInputElement).checked,
    hideNoTextVideo: ($("hideNoTextVideo") as HTMLInputElement).checked,
    apiBaseUrl: ($("apiBaseUrl") as HTMLInputElement).value.trim(),
    apiKey: ($("apiKey") as HTMLInputElement).value.trim(),
    textModel: ($("textModel") as HTMLInputElement).value.trim(),
    visionModel: ($("visionModel") as HTMLInputElement).value.trim(),
    strictness: Number(($("strictness") as HTMLInputElement).value),
    allowHandles: parseHandleList(($("allowHandles") as HTMLTextAreaElement).value),
    blockHandles: parseHandleList(($("blockHandles") as HTMLTextAreaElement).value),
    cryptoKeywords: parseKeywordList(
      ($("cryptoKeywords") as HTMLTextAreaElement).value,
    ),
    slopKeywords: parseKeywordList(($("slopKeywords") as HTMLTextAreaElement).value),
  };
}

function fillForm(settings: Settings): void {
  ($("enabled") as HTMLInputElement).checked = settings.enabled;
  ($("passthrough") as HTMLInputElement).checked = settings.passthrough;
  ($("hideNoTextImage") as HTMLInputElement).checked = settings.hideNoTextImage;
  ($("hideNoTextGif") as HTMLInputElement).checked = settings.hideNoTextGif;
  ($("hideNoTextVideo") as HTMLInputElement).checked = settings.hideNoTextVideo;
  ($("apiBaseUrl") as HTMLInputElement).value = settings.apiBaseUrl;
  ($("apiKey") as HTMLInputElement).value = settings.apiKey;
  ($("textModel") as HTMLInputElement).value = settings.textModel;
  ($("visionModel") as HTMLInputElement).value = settings.visionModel;
  ($("strictness") as HTMLInputElement).value = String(settings.strictness);
  $("strictnessVal").textContent = settings.strictness.toFixed(2);
  ($("allowHandles") as HTMLTextAreaElement).value = listToText(settings.allowHandles);
  ($("blockHandles") as HTMLTextAreaElement).value = listToText(settings.blockHandles);
  ($("cryptoKeywords") as HTMLTextAreaElement).value = listToText(
    settings.cryptoKeywords,
  );
  ($("slopKeywords") as HTMLTextAreaElement).value = listToText(settings.slopKeywords);
}

async function persistForm(): Promise<void> {
  const next = readForm();
  await saveSettings(next);
  await clearVerdictCache();
  await notifyTabs();
}

async function refreshStats(): Promise<void> {
  const stats = await loadStats();
  $("statClassified").textContent = String(stats.classified);
  $("statHidden").textContent = String(stats.hidden);
  $("statAi").textContent = String(stats.aiCalls);
  $("statVision").textContent = String(stats.visionCalls);
}

function setStatus(text: string, kind: "ok" | "err" | "" = ""): void {
  const el = $("status");
  el.textContent = text;
  el.className = kind;
}

async function notifyTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: ["https://x.com/*", "https://twitter.com/*"],
  });
  await Promise.all(
    tabs.map((tab) =>
      tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATED" }).catch(() => undefined)
        : Promise.resolve(),
    ),
  );
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  fillForm(settings);
  await refreshStats();

  $("strictness").addEventListener("input", () => {
    const v = Number(($("strictness") as HTMLInputElement).value);
    $("strictnessVal").textContent = v.toFixed(2);
  });

  $("saveBtn").addEventListener("click", async () => {
    try {
      await persistForm();
      setStatus("Saved", "ok");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed", "err");
    }
  });

  for (const id of ["hideNoTextImage", "hideNoTextGif", "hideNoTextVideo"]) {
    $(id).addEventListener("change", () => {
      void persistForm()
        .then(() => setStatus("Saved", "ok"))
        .catch((err) =>
          setStatus(err instanceof Error ? err.message : "Save failed", "err"),
        );
    });
  }

  $("undoBtn").addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs[0];
    if (tab?.id) {
      await chrome.tabs
        .sendMessage(tab.id, { type: "UNDO_LAST_HIDE" })
        .catch(() => undefined);
      setStatus("Undo sent", "ok");
    }
  });

  $("resetStatsBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "RESET_STATS" });
    await refreshStats();
    setStatus("Stats reset", "ok");
  });

  $("resetKeywordsBtn").addEventListener("click", () => {
    ($("cryptoKeywords") as HTMLTextAreaElement).value = listToText(
      DEFAULT_CRYPTO_KEYWORDS,
    );
    ($("slopKeywords") as HTMLTextAreaElement).value = listToText(
      DEFAULT_SLOP_KEYWORDS,
    );
    setStatus("Keywords reset — click Save", "ok");
  });

  $("updateBtn").addEventListener("click", async () => {
    try {
      ($("cryptoKeywords") as HTMLTextAreaElement).value = listToText(
        DEFAULT_CRYPTO_KEYWORDS,
      );
      ($("slopKeywords") as HTMLTextAreaElement).value = listToText(
        DEFAULT_SLOP_KEYWORDS,
      );
      await persistForm();
      setStatus("Updated defaults", "ok");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Update failed", "err");
    }
  });

  setInterval(() => {
    void refreshStats();
  }, 2000);
}

void init();
