import { accountVerdict, keywordVerdict, nameVerdict } from "./keywords";
import type { Settings, TweetData, Verdict } from "../shared/types";
import { sendMessage } from "../shared/messaging";
import { bumpStat } from "../shared/settings";

export interface ClassifyContext {
  tweet: TweetData;
  settings: Settings;
}

async function getCache(tweetId: string): Promise<Verdict | null> {
  try {
    const res = await sendMessage<{ ok: true; verdict: Verdict | null }>({
      type: "GET_CACHE",
      tweetId,
    });
    return res.ok ? res.verdict : null;
  } catch {
    return null;
  }
}

async function setCache(tweetId: string, verdict: Verdict): Promise<void> {
  try {
    await sendMessage({ type: "SET_CACHE", tweetId, verdict });
  } catch {
    // ignore
  }
}

async function recordLocal(verdict: Verdict): Promise<void> {
  try {
    await bumpStat("classified");
    if (verdict.hide) await bumpStat("hidden");
  } catch {
    // ignore
  }
}

async function classifyTextRemote(tweet: TweetData): Promise<Verdict> {
  const res = await sendMessage<
    { ok: true; verdict: Verdict } | { ok: false; error: string }
  >({
    type: "CLASSIFY_TEXT",
    tweetId: tweet.id,
    text: tweet.text,
    handle: tweet.handle,
  });
  if (!res.ok) {
    return {
      label: "unsure",
      confidence: 0,
      reason: res.error,
      source: "fail_open",
      hide: false,
    };
  }
  return res.verdict;
}

function mediaOnlyVerdict(
  tweet: TweetData,
  settings: Settings,
): Verdict | null {
  const noText = tweet.text.trim().length === 0;
  if (!noText) return null;

  const kind =
    tweet.mediaKind !== "none"
      ? tweet.mediaKind
      : tweet.hasVideo
        ? "video"
        : "none";
  if (kind === "none") return null;

  const hide =
    (kind === "image" && settings.hideNoTextImage) ||
    (kind === "gif" && settings.hideNoTextGif) ||
    (kind === "video" && settings.hideNoTextVideo);

  if (!hide) return null;

  return {
    label: "slop",
    confidence: 1,
    reason: `No-text ${kind} hidden`,
    source: "media_only",
    hide: true,
  };
}

function localRules(
  tweet: TweetData,
  settings: Settings,
): Verdict | null {
  return (
    accountVerdict(tweet.handle, settings) ||
    nameVerdict(tweet.displayName, tweet.handle, settings) ||
    mediaOnlyVerdict(tweet, settings) ||
    keywordVerdict(tweet.text, settings)
  );
}

/**
 * Local rules always win over cache (so adding "minecraft" applies immediately).
 * Cache is only reused for AI / fail-open results after local rules miss.
 */
export async function classifyTweet(ctx: ClassifyContext): Promise<Verdict> {
  const { tweet, settings } = ctx;

  if (!settings.enabled) {
    return {
      label: "unsure",
      confidence: 1,
      reason: "Disabled",
      source: "disabled",
      hide: false,
    };
  }

  const local = localRules(tweet, settings);
  if (local) {
    await setCache(tweet.id, local);
    await recordLocal(local);
    return local;
  }

  const cached = await getCache(tweet.id);
  if (cached) {
    return { ...cached, source: "cache" };
  }

  const hasApi = Boolean(settings.apiKey);

  if (hasApi && tweet.text.trim().length > 0) {
    const textVerdict = await classifyTextRemote(tweet);
    await setCache(tweet.id, textVerdict);
    await recordLocal(textVerdict);
    return textVerdict;
  }

  const open: Verdict = {
    label: "unsure",
    confidence: 0,
    reason: hasApi ? "No decisive signal" : "No API key; local rules only",
    source: "fail_open",
    hide: false,
  };
  await setCache(tweet.id, open);
  await recordLocal(open);
  return open;
}
