import { classifyTweet } from "../pipeline/classify";
import type { Settings } from "../shared/types";
import { loadSettings } from "../shared/settings";
import {
  applyVerdict,
  markPending,
  revealAll,
  undoLastHide,
} from "./apply";
import { ensureChip, refreshChip, setChipVisible } from "./chip";
import { extractTweet, getTweetArticles } from "./extract";

const processedGen = new WeakMap<HTMLElement, number>();
const inFlight = new Set<string>();

let settings: Settings | null = null;
let queue: HTMLElement[] = [];
let draining = false;
let generation = 0;

async function refreshSettings(): Promise<Settings> {
  settings = await loadSettings();
  return settings;
}

function applySettingsSideEffects(s: Settings): void {
  setChipVisible(s.enabled);
  generation += 1;
  queue = [];
  revealAll();
  refreshChip();
  scan(document);
}

async function processArticle(article: HTMLElement): Promise<void> {
  if (processedGen.get(article) === generation) return;
  const tweet = extractTweet(article);
  if (!tweet) return;

  if (inFlight.has(tweet.id)) return;
  inFlight.add(tweet.id);
  processedGen.set(article, generation);
  markPending(article);

  try {
    const s = settings ?? (await refreshSettings());
    if (!s.enabled) {
      applyVerdict(
        article,
        tweet.id,
        {
          label: "unsure",
          confidence: 1,
          reason: "Disabled",
          source: "disabled",
          hide: false,
        },
        true,
      );
      return;
    }

    const verdict = await classifyTweet({
      tweet,
      settings: s,
    });

    const effective = s.passthrough
      ? { ...verdict, hide: false, source: "passthrough" as const }
      : verdict;

    applyVerdict(article, tweet.id, effective, s.passthrough);
    refreshChip();
  } catch (err) {
    applyVerdict(
      article,
      tweet.id,
      {
        label: "unsure",
        confidence: 0,
        reason: err instanceof Error ? err.message : "Classify failed",
        source: "fail_open",
        hide: false,
      },
      false,
    );
  } finally {
    inFlight.delete(tweet.id);
  }
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const batch = queue.splice(0, 3);
      await Promise.all(batch.map((el) => processArticle(el)));
    }
  } finally {
    draining = false;
  }
}

function enqueue(article: HTMLElement): void {
  if (processedGen.get(article) === generation) return;
  if (!queue.includes(article)) queue.push(article);
  void drainQueue();
}

function scan(root: ParentNode = document): void {
  for (const article of getTweetArticles(root)) {
    enqueue(article);
  }
}

export async function startObserver(): Promise<void> {
  await refreshSettings();
  ensureChip();
  setChipVisible(settings?.enabled ?? true);

  scan(document);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches?.('article[data-testid="tweet"]')) {
          enqueue(node);
        } else {
          scan(node);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      (area === "sync" && changes.slopradar_settings) ||
      (area === "local" && changes.slopradar_api_key)
    ) {
      void refreshSettings().then(applySettingsSideEffects);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "UNDO_LAST_HIDE") {
      undoLastHide();
      refreshChip();
    }
    if (message?.type === "SETTINGS_UPDATED") {
      void refreshSettings().then(applySettingsSideEffects);
    }
  });
}
