import { classifyText, classifyVision, failOpen } from "../pipeline/ai";
import {
  bumpStat,
  getCachedVerdict,
  loadSettings,
  loadStats,
  resetStats,
  setCachedVerdict,
} from "../shared/settings";
import type { Message, MessageResponse } from "../shared/types";

type Job = () => Promise<void>;

const queue: Job[] = [];
let active = 0;
const MAX_CONCURRENCY = 2;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(async () => {
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      }
    });
    pump();
  });
}

function pump(): void {
  while (active < MAX_CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    active += 1;
    void job().finally(() => {
      active -= 1;
      pump();
    });
  }
}

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    void handleMessage(message).then(sendResponse);
    return true;
  },
);

async function handleMessage(message: Message): Promise<MessageResponse> {
  try {
    switch (message.type) {
      case "GET_SETTINGS": {
        const settings = await loadSettings();
        return { ok: true, settings };
      }
      case "GET_STATS": {
        const stats = await loadStats();
        return { ok: true, stats };
      }
      case "RESET_STATS": {
        const stats = await resetStats();
        return { ok: true, stats };
      }
      case "GET_CACHE": {
        const verdict = await getCachedVerdict(message.tweetId);
        return { ok: true, verdict };
      }
      case "SET_CACHE": {
        await setCachedVerdict(message.tweetId, message.verdict);
        return { ok: true };
      }
      case "CLASSIFY_TEXT": {
        const verdict = await enqueue(async () => {
          const settings = await loadSettings();
          try {
            const v = await classifyText(
              message.text,
              message.handle,
              settings,
            );
            await bumpStat("aiCalls");
            await setCachedVerdict(message.tweetId, v);
            return v;
          } catch (err) {
            return failOpen(err instanceof Error ? err.message : "Text AI failed");
          }
        });
        return { ok: true, verdict };
      }
      case "CLASSIFY_VISION": {
        const verdict = await enqueue(async () => {
          const settings = await loadSettings();
          try {
            const v = await classifyVision(
              message.text,
              message.handle,
              message.imageDataUrl,
              settings,
            );
            await bumpStat("aiCalls");
            await bumpStat("visionCalls");
            await setCachedVerdict(message.tweetId, v);
            return v;
          } catch (err) {
            return failOpen(
              err instanceof Error ? err.message : "Vision AI failed",
            );
          }
        });
        return { ok: true, verdict };
      }
      case "UNDO_LAST_HIDE":
      case "SETTINGS_UPDATED":
        return { ok: true };
      default:
        return { ok: false, error: "Unknown message" };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Handler failed",
    };
  }
}
