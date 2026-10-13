import type { MediaKind, TweetData } from "../shared/types";

const TWEET_SELECTOR = 'article[data-testid="tweet"]';

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
  const userLink = article.querySelector<HTMLAnchorElement>(
    'a[role="link"][href^="/"]',
  );
  // Prefer the @username text
  const spans = Array.from(article.querySelectorAll("span")).map((s) =>
    s.textContent?.trim() ?? "",
  );
  const at = spans.find((t) => /^@[A-Za-z0-9_]{1,15}$/.test(t));
  if (at) return at.slice(1).toLowerCase();

  const href = userLink?.getAttribute("href");
  if (href && /^\/[A-Za-z0-9_]{1,15}\/?$/.test(href)) {
    return href.replace(/\//g, "").toLowerCase();
  }
  return "";
}

function extractText(article: HTMLElement): string {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  if (!textEl) return "";
  return (textEl.textContent ?? "").replace(/\s+/g, " ").trim();
}

function extractMedia(article: HTMLElement): {
  mediaKind: MediaKind;
  imageUrls: string[];
  hasVideo: boolean;
} {
  const video = article.querySelector("video");
  const hasVideo = Boolean(video);

  const images = Array.from(
    article.querySelectorAll<HTMLImageElement>(
      '[data-testid="tweetPhoto"] img, [data-testid="card.layoutLarge.media"] img, div[aria-label] img',
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

  // Also check for media photo containers
  if (imageUrls.length === 0) {
    for (const img of article.querySelectorAll("img")) {
      const src = img.currentSrc || img.src;
      if (!src) continue;
      if (src.includes("profile_images") || src.includes("emoji")) continue;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w >= 80 && h >= 80) imageUrls.push(src);
    }
  }

  let mediaKind: MediaKind = "none";
  if (hasVideo) {
    // X often uses <video> for GIFs too
    const isGif =
      article.textContent?.toLowerCase().includes("gif") ||
      Boolean(video?.closest('[data-testid="videoPlayer"]') && video.loop);
    mediaKind = isGif && (video?.duration ?? 0) < 15 ? "gif" : "video";
  } else if (imageUrls.length > 0) {
    mediaKind = "image";
  }

  return { mediaKind, imageUrls: [...new Set(imageUrls)], hasVideo };
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
  // Collapse the timeline cell wrapper when present
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  return (cell as HTMLElement) || article;
}
