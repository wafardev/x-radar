import type { TweetData } from "../shared/types";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.7): string {
  return canvas.toDataURL("image/jpeg", quality);
}

function drawToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxEdge = 768,
): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2d context");
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

async function captureFromImageUrl(url: string): Promise<string> {
  // Prefer fetching as blob to avoid tainted canvas when possible
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await loadImage(objectUrl);
      const canvas = drawToCanvas(img, img.naturalWidth, img.naturalHeight);
      return canvasToJpeg(canvas);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    const img = await loadImage(url);
    const canvas = drawToCanvas(img, img.naturalWidth, img.naturalHeight);
    return canvasToJpeg(canvas);
  }
}

function waitForEvent(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`Error on ${event}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onOk);
      target.removeEventListener("error", onErr);
    };
    target.addEventListener(event, onOk, { once: true });
    target.addEventListener("error", onErr, { once: true });
  });
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<string> {
  if (video.readyState < 2) {
    video.muted = true;
    const playPromise = video.play();
    if (playPromise) await playPromise.catch(() => undefined);
    await waitForEvent(video, "loadeddata", 4000).catch(() => undefined);
  }

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const target = duration > 0 ? duration * 0.5 : 0;

  if (target > 0 && Math.abs(video.currentTime - target) > 0.15) {
    const seekPromise = waitForEvent(video, "seeked", 3000);
    video.currentTime = target;
    await seekPromise.catch(() => undefined);
  }

  if (video.videoWidth < 2 || video.videoHeight < 2) {
    throw new Error("Video has no dimensions");
  }

  const canvas = drawToCanvas(video, video.videoWidth, video.videoHeight);
  return canvasToJpeg(canvas);
}

function findVideo(article: HTMLElement): HTMLVideoElement | null {
  return article.querySelector("video");
}

/**
 * Capture a JPEG data URL for vision classification.
 * Prefers video mid-frame when present; otherwise first usable image.
 */
export async function captureMediaFrame(
  article: HTMLElement,
  tweet: TweetData,
): Promise<string | null> {
  try {
    if (tweet.hasVideo || tweet.mediaKind === "video" || tweet.mediaKind === "gif") {
      const video = findVideo(article);
      if (video) {
        try {
          return await captureVideoFrame(video);
        } catch {
          // fall through to image / poster
        }
        const poster = video.getAttribute("poster");
        if (poster) return await captureFromImageUrl(poster);
      }
    }

    for (const url of tweet.imageUrls) {
      if (!url || url.startsWith("data:")) continue;
      try {
        return await captureFromImageUrl(url);
      } catch {
        continue;
      }
    }

    // Last resort: any large img inside the article media region
    const imgs = Array.from(article.querySelectorAll("img")).filter((img) => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      return w >= 64 && h >= 64 && !img.alt?.toLowerCase().includes("profile");
    });
    for (const img of imgs) {
      const src = img.currentSrc || img.src;
      if (!src) continue;
      try {
        return await captureFromImageUrl(src);
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}
