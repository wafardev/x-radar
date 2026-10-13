import { accountVerdict, keywordVerdict } from "./keywords";
import { needsVision } from "./ai";
import type { Settings, TweetData, Verdict } from "../shared/types";
import { sendMessage } from "../shared/messaging";
import { bumpStat } from "../shared/settings";

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
    // content may lack session storage in some contexts; ignore
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

async function classifyVisionRemote(
  tweet: TweetData,
  imageDataUrl: string,
): Promise<Verdict> {
  const res = await sendMessage<
    { ok: true; verdict: Verdict } | { ok: false; error: string }
  >({
    type: "CLASSIFY_VISION",
    tweetId: tweet.id,
    text: tweet.text,
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

/**
 * Full tiered classification. Fail-open on AI errors.
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

  const cached = await getCache(tweet.id);
  if (cached) {
    return { ...cached, source: "cache" };
  }

  const account = accountVerdict(tweet.handle, settings);
  if (account) {
    await setCache(tweet.id, account);
    await recordLocal(account);
    return account;
  }

  const keywords = keywordVerdict(tweet.text, settings);
  if (keywords) {
    await setCache(tweet.id, keywords);
    await recordLocal(keywords);
    return keywords;
  }

  const hasApi = Boolean(settings.apiKey);
  let textVerdict: Verdict | null = null;

  if (hasApi && tweet.text.trim().length > 0) {
    textVerdict = await classifyTextRemote(tweet);
  }

  const shouldVision =
    hasApi &&
    tweet.mediaKind !== "none" &&
    (needsVision(tweet.text, tweet.mediaKind, textVerdict) ||
      tweet.text.trim().length < 40);

  if (shouldVision) {
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
