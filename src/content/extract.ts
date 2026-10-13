import type { MediaKind, TweetData } from "../shared/types";

const TWEET_SELECTOR = 'article[data-testid="tweet"]';

/** Text that is only a media shortlink counts as no caption. */
const MEDIA_ONLY_TEXT_RE =
  /^(?:https?:\/\/)?(?:t\.co\/\w+|pic\.x\.com\/\w+|x\.com\/\S+\/(?:status\/\d+\/)?(?:video|photo)\/\d+)(?:\s*)$/i;

export function getTweetArticles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_SELECTOR));
}

function statusIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = href.match(/\/status\/(\d+)/);
  return match?.[1] ?? null;
}

/** Main tweet id from the timestamp link (not the quoted status). */
function extractTweetId(article: HTMLElement): string | null {
  const timeLink = article.querySelector("time")?.closest("a[href*='/status/']");
  const fromTime = statusIdFromHref(timeLink?.getAttribute("href"));
  if (fromTime) return fromTime;

  for (const link of article.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/status/"]',
  )) {
    if (link.closest('[data-testid="quoteTweet"]')) continue;
    const id = statusIdFromHref(link.getAttribute("href"));
    if (id) return id;
  }
  return null;
}

function extractHandle(article: HTMLElement): string {
  const spans = Array.from(article.querySelectorAll("span")).map(
    (s) => s.textContent?.trim() ?? "",
  );
  const at = spans.find((t) => /^@[A-Za-z0-9_]{1,15}$/.test(t));
  if (at) return at.slice(1).toLowerCase();

  const userLink = article.querySelector<HTMLAnchorElement>(
    'a[role="link"][href^="/"]',
  );
  const href = userLink?.getAttribute("href");
  if (href && /^\/[A-Za-z0-9_]{1,15}\/?$/.test(href)) {
    return href.replace(/\//g, "").toLowerCase();
  }
  return "";
}

function extractDisplayName(article: HTMLElement): string {
  const userName = article.querySelector('[data-testid="User-Name"]');
  if (userName) {
    const parts = Array.from(userName.querySelectorAll("span"))
      .map((s) => s.textContent?.trim() ?? "")
      .filter(Boolean);
    for (const part of parts) {
      if (part.startsWith("@")) continue;
      if (part === "·") continue;
      if (/^\d+[smhd]$/i.test(part)) continue;
      if (part.length >= 1) return part;
    }
    const raw = userName.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return raw.split("@")[0]?.trim() ?? raw;
  }

  const link = article.querySelector<HTMLAnchorElement>(
    'a[role="link"][href^="/"]',
  );
  const label = link?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (label && !label.startsWith("@")) {
    return label.split("@")[0]?.trim() ?? label;
  }
  return "";
}

export function normalizeTweetText(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (MEDIA_ONLY_TEXT_RE.test(text)) return "";
  const stripped = text
    .replace(/\s*(?:https?:\/\/)?(?:t\.co\/\w+|pic\.x\.com\/\w+)\s*$/gi, "")
    .trim();
  return stripped;
}

function isInsideQuote(el: Element, mainTweetId: string | null): boolean {
  if (el.closest('[data-testid="quoteTweet"]')) return true;

  const nestedArticle = el.closest("article");
  const rootArticle = el.closest('article[data-testid="tweet"]');
  if (
    nestedArticle &&
    rootArticle &&
    nestedArticle !== rootArticle &&
    rootArticle.contains(nestedArticle)
  ) {
    return true;
  }

  const statusEl = el.closest<HTMLElement>(
    'a[href*="/status/"], div[role="link"][href*="/status/"]',
  );
  if (!statusEl || !mainTweetId) return false;
  const href =
    statusEl.getAttribute("href") ||
    statusEl.querySelector("a[href*='/status/']")?.getAttribute("href") ||
    "";
  const id = statusIdFromHref(href);
  return Boolean(id && id !== mainTweetId);
}

function extractPrimaryAndQuoteText(
  article: HTMLElement,
  mainTweetId: string | null,
): {
  text: string;
  quoteText: string;
  hasQuote: boolean;
} {
  const nodes = Array.from(
    article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]'),
  );
  const primary: string[] = [];
  const quoted: string[] = [];

  for (const node of nodes) {
    const normalized = normalizeTweetText(node.textContent ?? "");
    if (!normalized) continue;
    if (isInsideQuote(node, mainTweetId)) quoted.push(normalized);
    else primary.push(normalized);
  }

  let hasQuoteUi = Boolean(article.querySelector('[data-testid="quoteTweet"]'));
  if (!hasQuoteUi && mainTweetId) {
    for (const link of article.querySelectorAll<HTMLElement>(
      'a[href*="/status/"], div[role="link"][href*="/status/"]',
    )) {
      const href =
        link.getAttribute("href") ||
        link.querySelector("a[href*='/status/']")?.getAttribute("href") ||
        "";
      const id = statusIdFromHref(href);
      if (id && id !== mainTweetId) {
        hasQuoteUi = true;
        break;
      }
    }
  }

  return {
    text: primary.join(" ").trim(),
    quoteText: quoted.join(" ").trim(),
    hasQuote: hasQuoteUi || quoted.length > 0,
  };
}

function extractLinkSignals(article: HTMLElement): string {
  const bits: string[] = [];
  for (const a of article.querySelectorAll("a[href]")) {
    const href = (a.getAttribute("href") || "").toLowerCase();
    if (
      href.includes("tiktok.com") ||
      href.includes("instagram.com") ||
      href.includes("youtube.com/shorts")
    ) {
      bits.push(href);
    }
  }
  for (const el of article.querySelectorAll("[aria-label]")) {
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    if (
      label.includes("tiktok") ||
      label.includes("instagram") ||
      label.includes("reels")
    ) {
      bits.push(label);
    }
  }
  return bits.join(" ");
}

function extractMedia(article: HTMLElement): {
  mediaKind: MediaKind;
  imageUrls: string[];
  hasVideo: boolean;
} {
  const video = article.querySelector("video");
  const videoPlayer = article.querySelector(
    '[data-testid="videoPlayer"], [data-testid="videoComponent"], [aria-label="Video player"], [aria-label*="Embedded video"]',
  );
  const gifPlayer = article.querySelector(
    '[data-testid="gifPlayer"], [aria-label*="GIF"]',
  );
  const playButton = article.querySelector(
    '[data-testid="previewInterstitial"] [aria-label="Play"], button[aria-label="Play Video"], button[aria-label="Play"]',
  );
  const videoStatusLink = article.querySelector(
    'a[href*="/video/"], a[href*="/status/"][href*="/video/"]',
  );
  const hasVideoUi = Boolean(
    video || videoPlayer || gifPlayer || playButton || videoStatusLink,
  );

  const images = Array.from(
    article.querySelectorAll<HTMLImageElement>(
      '[data-testid="tweetPhoto"] img, [data-testid="card.layoutLarge.media"] img, [data-testid="videoPlayer"] img, [data-testid="videoComponent"] img',
    ),
  );

  const imageUrls: string[] = [];
  for (const img of images) {
    const src = img.currentSrc || img.src;
    if (!src) continue;
    if (src.includes("profile_images")) continue;
    if (src.includes("emoji")) continue;
    imageUrls.push(src);
  }

  if (imageUrls.length === 0) {
    for (const img of article.querySelectorAll("img")) {
      const src = img.currentSrc || img.src;
      if (!src) continue;
      if (src.includes("profile_images") || src.includes("emoji")) continue;
      if (
        src.includes("amplify_video_thumb") ||
        src.includes("ext_tw_video_thumb") ||
        src.includes("tweet_video_thumb") ||
        src.includes("media")
      ) {
        imageUrls.push(src);
        continue;
      }
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w >= 80 && h >= 80) imageUrls.push(src);
    }
  }

  if (imageUrls.length === 0) {
    for (const el of article.querySelectorAll<HTMLElement>("div, span")) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none") continue;
      const m = bg.match(/url\(["']?(https:\/\/pbs\.twimg\.com\/[^"')]+)/);
      if (!m) continue;
      if (
        m[1].includes("amplify_video_thumb") ||
        m[1].includes("ext_tw_video_thumb") ||
        m[1].includes("media")
      ) {
        imageUrls.push(m[1]);
      }
    }
  }

  const photoLink = article.querySelector('a[href*="/photo/"]');
  const hasPhotoUi = Boolean(
    photoLink || article.querySelector('[data-testid="tweetPhoto"]'),
  );

  let mediaKind: MediaKind = "none";
  if (hasVideoUi || video) {
    const labeledGif =
      Boolean(gifPlayer) ||
      Boolean(article.querySelector('[aria-label*="GIF"]')) ||
      (video?.loop === true && (video.duration || 0) > 0 && video.duration < 15);
    mediaKind = labeledGif ? "gif" : "video";
  } else if (imageUrls.length > 0 || hasPhotoUi) {
    mediaKind = "image";
  }

  return {
    mediaKind,
    imageUrls: [...new Set(imageUrls)],
    hasVideo: mediaKind === "video" || mediaKind === "gif" || Boolean(video),
  };
}

export function extractTweet(article: HTMLElement): TweetData | null {
  const id = extractTweetId(article);
  if (!id) return null;

  const { mediaKind, imageUrls, hasVideo } = extractMedia(article);
  const { text, quoteText, hasQuote } = extractPrimaryAndQuoteText(article, id);
  const linkSignals = extractLinkSignals(article);

  return {
    id,
    text,
    quoteText: [quoteText, linkSignals].filter(Boolean).join(" ").trim(),
    handle: extractHandle(article),
    displayName: extractDisplayName(article),
    mediaKind,
    imageUrls,
    hasVideo,
    hasQuote,
  };
}

export function hideTargetFor(article: HTMLElement): HTMLElement {
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  return (cell as HTMLElement) || article;
}
