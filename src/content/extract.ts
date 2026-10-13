import type { MediaKind, TweetData } from "../shared/types";

const TWEET_SELECTOR = 'article[data-testid="tweet"]';

/** Text that is only a media shortlink counts as no caption. */
const MEDIA_ONLY_TEXT_RE =
  /^(?:https?:\/\/)?(?:t\.co\/\w+|pic\.x\.com\/\w+|x\.com\/\S+\/(?:status\/\d+\/)?(?:video|photo)\/\d+)(?:\s*)$/i;

export function getTweetArticles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_SELECTOR));
}

function extractTweetId(article: HTMLElement): string | null {
  const statusLink = article.querySelector<HTMLAnchorElement>(
    'a[href*="/status/"]',
  );
  if (!statusLink) return null;
  const match = statusLink.getAttribute("href")?.match(/\/status\/(\d+)/);
  return match?.[1] ?? null;
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

export function normalizeTweetText(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (MEDIA_ONLY_TEXT_RE.test(text)) return "";
  // Strip trailing media shortlinks that X appends to captions
  const stripped = text
    .replace(/\s*(?:https?:\/\/)?(?:t\.co\/\w+|pic\.x\.com\/\w+)\s*$/gi, "")
    .trim();
  return stripped;
}

function extractText(article: HTMLElement): string {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  if (!textEl) return "";
  return normalizeTweetText(textEl.textContent ?? "");
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

  // CSS background posters on video placeholders
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
  return {
    id,
    text: extractText(article),
    handle: extractHandle(article),
    mediaKind,
    imageUrls,
    hasVideo,
  };
}

export function hideTargetFor(article: HTMLElement): HTMLElement {
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  return (cell as HTMLElement) || article;
}
