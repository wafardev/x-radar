import { needsVision } from "./ai";
import { accountVerdict, keywordVerdict } from "./keywords";
import type { Settings, TweetData, Verdict } from "../shared/types";
import { sendMessage } from "../shared/messaging";
import { bumpStat, isTweetStamped } from "../shared/settings";

export interface ClassifyContext {
  article: HTMLElement;
  tweet: TweetData;
  settings: Settings;
  captureFrame: (
    article: HTMLElement,
    tweet: TweetData,
  ) => Promise<string | null>;
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
    text: [tweet.text, tweet.quoteText].filter(Boolean).join("\n"),
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

async function classifyVisionRemote(
  tweet: TweetData,
  imageDataUrl: string,
): Promise<Verdict> {
  const res = await sendMessage<
    { ok: true; verdict: Verdict } | { ok: false; error: string }
  >({
    type: "CLASSIFY_VISION",
    tweetId: tweet.id,
    text: [tweet.text, tweet.quoteText].filter(Boolean).join("\n"),
    handle: tweet.handle,
    imageDataUrl,
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
        : tweet.hasQuote
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
    reason: tweet.hasQuote
      ? `No-text quote/${kind} hidden`
      : `No-text ${kind} hidden`,
    source: "media_only",
    hide: true,
  };
}

function localRules(tweet: TweetData, settings: Settings): Verdict | null {
  return (
    accountVerdict(tweet.handle, settings) ||
    mediaOnlyVerdict(tweet, settings) ||
    keywordVerdict(
      [tweet.text, tweet.quoteText, tweet.displayName, tweet.handle]
        .filter(Boolean)
        .join("\n"),
      settings,
    )
  );
}

/**
 * Local rules → text AI → vision (OpenRouter) for ambiguous media.
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

  if (await isTweetStamped(tweet.id)) {
    const stamped: Verdict = {
      label: "slop",
      confidence: 1,
      reason: "Manually stamped as slop",
      source: "manual_slop",
      hide: true,
    };
    await setCache(tweet.id, stamped);
    return stamped;
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
  let textVerdict: Verdict | null = null;

  if (hasApi && (tweet.text.trim().length > 0 || tweet.quoteText.trim().length > 0)) {
    textVerdict = await classifyTextRemote(tweet);
    if (!needsVision(tweet.text || tweet.quoteText, tweet.mediaKind, textVerdict)) {
      await setCache(tweet.id, textVerdict);
      await recordLocal(textVerdict);
      return textVerdict;
    }
  }

  if (
    hasApi &&
    tweet.mediaKind !== "none" &&
    needsVision(tweet.text || tweet.quoteText, tweet.mediaKind, textVerdict)
  ) {
    const frame = await ctx.captureFrame(ctx.article, tweet);
    if (frame) {
      const visionVerdict = await classifyVisionRemote(tweet, frame);
      await setCache(tweet.id, visionVerdict);
      await recordLocal(visionVerdict);
      return visionVerdict;
    }
  }

  if (textVerdict) {
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
