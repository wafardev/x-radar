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

/**
 * Modern X quote cards are usually `div[role="link"][tabindex]` without an
 * href — click navigates via JS. Older builds used data-testid="quoteTweet".
 * Treat those wrappers (and nested articles) as quote roots so quoted text
 * never leaks into the outer caption.
 */
function collectQuoteRoots(
  article: HTMLElement,
  mainTweetId: string | null,
): Element[] {
  const roots: Element[] = [];
  const seen = new Set<Element>();

  const add = (el: Element | null | undefined) => {
    if (!el || el === article || !article.contains(el) || seen.has(el)) return;
    // Prefer outer-most card when nested.
    for (let i = roots.length - 1; i >= 0; i--) {
      const existing = roots[i]!;
      if (existing.contains(el)) return;
      if (el.contains(existing)) {
        seen.delete(existing);
        roots.splice(i, 1);
      }
    }
    seen.add(el);
    roots.push(el);
  };

  for (const el of article.querySelectorAll('[data-testid="quoteTweet"]')) {
    add(el);
  }

  for (const nested of article.querySelectorAll("article")) {
    if (nested !== article) add(nested);
  }

  // Clickable quote card: role=link + tabindex, with its own author row.
  for (const el of article.querySelectorAll<HTMLElement>(
    'div[role="link"][tabindex]',
  )) {
    if (!el.querySelector('[data-testid="User-Name"]')) continue;
    // Must point at a *different* status when we can tell.
    if (mainTweetId) {
      let otherStatus = false;
      for (const link of el.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/status/"]',
      )) {
        const id = statusIdFromHref(link.getAttribute("href"));
        if (id && id !== mainTweetId) {
          otherStatus = true;
          break;
        }
      }
      // Some cards only expose /i/status via aria / child without matching yet —
      // still treat User-Name + tweetText|media inside role=link as a quote.
      if (
        !otherStatus &&
        !el.querySelector('[data-testid="tweetText"], [data-testid="tweetPhoto"], video')
      ) {
        continue;
      }
    }
    add(el);
  }

  // Fallback: any status link to another id → nearest role=link card.
  if (mainTweetId) {
    for (const link of article.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/status/"]',
    )) {
      const id = statusIdFromHref(link.getAttribute("href"));
      if (!id || id === mainTweetId) continue;
      const card =
        link.closest('[data-testid="quoteTweet"]') ||
        link.closest('div[role="link"][tabindex]') ||
        link.closest("article");
      add(card);
    }
  }

  return roots;
}

function isInsideQuote(el: Element, quoteRoots: Element[]): boolean {
  return quoteRoots.some((root) => root.contains(el));
}

function extractPrimaryAndQuoteText(
  article: HTMLElement,
  quoteRoots: Element[],
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
    if (isInsideQuote(node, quoteRoots)) quoted.push(normalized);
    else primary.push(normalized);
  }

  return {
    text: primary.join(" ").trim(),
    quoteText: quoted.join(" ").trim(),
    hasQuote: quoteRoots.length > 0 || quoted.length > 0,
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

function inMediaScope(
  el: Element,
  quoteRoots: Element[],
  scope: "own" | "quote",
): boolean {
  // No quote card → everything is "own"; "quote" scope is empty.
  if (quoteRoots.length === 0) return scope === "own";
  const inside = isInsideQuote(el, quoteRoots);
  return scope === "quote" ? inside : !inside;
}

function queryFirstInScope(
  article: HTMLElement,
  selector: string,
  quoteRoots: Element[],
  scope: "own" | "quote",
): Element | null {
  for (const el of article.querySelectorAll(selector)) {
    if (inMediaScope(el, quoteRoots, scope)) return el;
  }
  return null;
}

function extractMedia(
  article: HTMLElement,
  quoteRoots: Element[],
  scope: "own" | "quote",
): {
  mediaKind: MediaKind;
  imageUrls: string[];
  hasVideo: boolean;
} {
  const video = queryFirstInScope(
    article,
    "video",
    quoteRoots,
    scope,
  ) as HTMLVideoElement | null;
  const videoPlayer = queryFirstInScope(
    article,
    '[data-testid="videoPlayer"], [data-testid="videoComponent"], [aria-label="Video player"], [aria-label*="Embedded video"]',
    quoteRoots,
    scope,
  );
  const gifPlayer = queryFirstInScope(
    article,
    '[data-testid="gifPlayer"], [aria-label*="GIF"]',
    quoteRoots,
    scope,
  );
  const playButton = queryFirstInScope(
    article,
    '[data-testid="previewInterstitial"] [aria-label="Play"], button[aria-label="Play Video"], button[aria-label="Play"]',
    quoteRoots,
    scope,
  );
  const videoStatusLink = queryFirstInScope(
    article,
    'a[href*="/video/"], a[href*="/status/"][href*="/video/"]',
    quoteRoots,
    scope,
  );
  const hasVideoUi = Boolean(
    video || videoPlayer || gifPlayer || playButton || videoStatusLink,
  );

  const imageUrls: string[] = [];
  const pushImg = (src: string | null | undefined) => {
    if (!src) return;
    if (src.includes("profile_images") || src.includes("emoji")) return;
    imageUrls.push(src);
  };

  for (const img of article.querySelectorAll<HTMLImageElement>(
    '[data-testid="tweetPhoto"] img, [data-testid="card.layoutLarge.media"] img, [data-testid="videoPlayer"] img, [data-testid="videoComponent"] img',
  )) {
    if (!inMediaScope(img, quoteRoots, scope)) continue;
    pushImg(img.currentSrc || img.src);
  }

  if (imageUrls.length === 0) {
    for (const img of article.querySelectorAll("img")) {
      if (!inMediaScope(img, quoteRoots, scope)) continue;
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
      if (!inMediaScope(el, quoteRoots, scope)) continue;
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

  const photoLink = queryFirstInScope(
    article,
    'a[href*="/photo/"]',
    quoteRoots,
    scope,
  );
  const tweetPhoto = queryFirstInScope(
    article,
    '[data-testid="tweetPhoto"]',
    quoteRoots,
    scope,
  );
  const hasPhotoUi = Boolean(photoLink || tweetPhoto);

  const thumbLooksLikeVideo = imageUrls.some(
    (u) =>
      u.includes("amplify_video_thumb") ||
      u.includes("ext_tw_video_thumb") ||
      u.includes("tweet_video_thumb") ||
      u.includes("video_thumb"),
  );

  let mediaKind: MediaKind = "none";
  if (hasVideoUi || video || thumbLooksLikeVideo) {
    const gifLabel = queryFirstInScope(
      article,
      '[aria-label*="GIF"]',
      quoteRoots,
      scope,
    );
    const labeledGif =
      Boolean(gifPlayer) ||
      Boolean(gifLabel) ||
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

  const quoteRoots = collectQuoteRoots(article, id);
  const { text, quoteText, hasQuote } = extractPrimaryAndQuoteText(
    article,
    quoteRoots,
  );
  const own = extractMedia(article, quoteRoots, "own");
  const quoted = extractMedia(article, quoteRoots, "quote");
  const linkSignals = extractLinkSignals(article);

  return {
    id,
    text,
    quoteText: [quoteText, linkSignals].filter(Boolean).join(" ").trim(),
    handle: extractHandle(article),
    displayName: extractDisplayName(article),
    mediaKind: own.mediaKind,
    quoteMediaKind: quoted.mediaKind,
    imageUrls: own.imageUrls.length > 0 ? own.imageUrls : quoted.imageUrls,
    hasVideo: own.hasVideo || quoted.hasVideo,
    hasQuote,
  };
}

export function hideTargetFor(article: HTMLElement): HTMLElement {
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  return (cell as HTMLElement) || article;
}
