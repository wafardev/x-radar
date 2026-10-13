import { needsVision } from "./ai";
import { accountVerdict, keywordVerdict, scoreKeywords } from "./keywords";
import type { MediaKind, Settings, TweetData, Verdict } from "../shared/types";
import { sendMessage } from "../shared/messaging";
import { bumpStat, isTweetStamped } from "../shared/settings";

/** Short reaction captions on quote-of-media posts (e.g. "Please stop this"). */
const SHORT_QUOTE_CAPTION_CHARS = 120;

function mediaKindForHideToggles(tweet: TweetData): MediaKind {
  if (tweet.mediaKind !== "none") return tweet.mediaKind;
  if (tweet.quoteMediaKind !== "none") return tweet.quoteMediaKind;
  if (tweet.hasVideo) return "video";
  return "none";
}

function hideToggleForKind(kind: MediaKind, settings: Settings): boolean {
  return (
    (kind === "image" && settings.hideNoTextImage) ||
    (kind === "gif" && settings.hideNoTextGif) ||
    (kind === "video" && settings.hideNoTextVideo)
  );
}

function classifyTextPayload(tweet: TweetData): string {
  const bits = [tweet.text, tweet.quoteText].filter(Boolean);
  if (tweet.hasQuote && tweet.quoteMediaKind !== "none") {
    bits.push(`[Quoted tweet contains ${tweet.quoteMediaKind}]`);
  }
  if (tweet.mediaKind !== "none") {
    bits.push(`[Own media: ${tweet.mediaKind}]`);
  }
  return bits.join("\n");
}

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
    text: classifyTextPayload(tweet),
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
    text: classifyTextPayload(tweet),
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

  const kind = mediaKindForHideToggles(tweet);
  if (kind === "none") return null;
  if (!hideToggleForKind(kind, settings)) return null;

  return {
    label: "slop",
    confidence: 1,
    reason: `No-text ${kind} hidden`,
    source: "media_only",
    hide: true,
  };
}

/**
 * Classic timeline slop: no own caption, just a video/image reacting to a quote.
 */
function quoteReactionVerdict(
  tweet: TweetData,
  settings: Settings,
): Verdict | null {
  if (tweet.text.trim().length > 0) return null;
  if (!tweet.hasQuote) return null;

  const kind = mediaKindForHideToggles(tweet);
  if (kind === "none") return null;
  if (!hideToggleForKind(kind, settings)) return null;

  return {
    label: "slop",
    confidence: 1,
    reason: `Quote reaction ${kind} (no caption)`,
    source: "quote_reaction",
    hide: true,
  };
}

/**
 * Short reaction caption quoting someone else's video/image ("Please stop this").
 * Long crypto commentary quoting media still goes through AI.
 */
function quoteOfMediaVerdict(
  tweet: TweetData,
  settings: Settings,
): Verdict | null {
  if (!tweet.hasQuote) return null;
  // Prefer quoted media; fall back to any media on the card if quote scoping missed.
  const kind =
    tweet.quoteMediaKind !== "none"
      ? tweet.quoteMediaKind
      : tweet.mediaKind !== "none"
        ? tweet.mediaKind
        : tweet.hasVideo
          ? "video"
          : "none";
  if (kind === "none") return null;
  if (!hideToggleForKind(kind, settings)) return null;

  const caption = tweet.text.trim();
  if (caption.length > SHORT_QUOTE_CAPTION_CHARS) return null;

  const { cryptoHits } = scoreKeywords(
    [tweet.text, tweet.quoteText].filter(Boolean).join("\n"),
    settings,
  );
  if (cryptoHits > 0) return null;

  return {
    label: "slop",
    confidence: 1,
    reason: caption
      ? `Short caption quoting ${kind}`
      : `Quote of ${kind} (no caption)`,
    source: "quote_of_media",
    hide: true,
  };
}

function localRules(tweet: TweetData, settings: Settings): Verdict | null {
  return (
    accountVerdict(tweet.handle, settings) ||
    quoteReactionVerdict(tweet, settings) ||
    quoteOfMediaVerdict(tweet, settings) ||
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
  const visionMedia = mediaKindForHideToggles(tweet);
  const textForVision = tweet.text || tweet.quoteText;

  if (
    hasApi &&
    (tweet.text.trim().length > 0 ||
      tweet.quoteText.trim().length > 0 ||
      visionMedia !== "none")
  ) {
    textVerdict = await classifyTextRemote(tweet);
    if (!needsVision(textForVision, visionMedia, textVerdict)) {
      await setCache(tweet.id, textVerdict);
      await recordLocal(textVerdict);
      return textVerdict;
    }
  }

  if (
    hasApi &&
    visionMedia !== "none" &&
    needsVision(textForVision, visionMedia, textVerdict)
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
