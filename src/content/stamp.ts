const OVERLAY_CLASS = "slopradar-stamp-overlay";
const MARK_CLASS = "slopradar-stamp-mark";
const STYLE_ID = "slopradar-stamp-anim-style-v2";

function ensureStampStyles(): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  // Always refresh so reloads pick up brighter styles even if an old tag lingered
  style.textContent = `
    .${OVERLAY_CLASS} {
      position: absolute !important;
      inset: 0 !important;
      z-index: 2147483000 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      pointer-events: none !important;
      overflow: hidden !important;
      background: rgba(0, 0, 0, 0.45) !important;
      border-radius: 4px !important;
    }
    .${OVERLAY_CLASS}--linger {
      background: rgba(0, 0, 0, 0.22) !important;
    }
    .${MARK_CLASS} {
      font: 900 56px/1 "Arial Black", Impact, Haettenschweiler, sans-serif !important;
      letter-spacing: 0.14em !important;
      color: #39ff14 !important;
      -webkit-text-stroke: 2px #0a0a0a !important;
      text-transform: uppercase !important;
      transform: rotate(-18deg) scale(2.4);
      opacity: 0;
      filter: blur(1px);
      animation: slopradar-stamp-smash 520ms cubic-bezier(0.15, 1.4, 0.35, 1) forwards;
      text-shadow:
        0 0 8px #39ff14,
        0 0 24px #39ff14,
        0 0 48px rgba(57, 255, 20, 0.9),
        0 2px 0 #0a0a0a !important;
      user-select: none !important;
    }
    .${MARK_CLASS} span {
      display: inline-block;
      border: 5px solid #39ff14;
      background: rgba(57, 255, 20, 0.2);
      padding: 12px 22px;
      border-radius: 8px;
      box-shadow:
        0 0 0 3px #0a0a0a,
        0 0 28px rgba(57, 255, 20, 0.85),
        inset 0 0 18px rgba(57, 255, 20, 0.35);
    }
    .${MARK_CLASS}--linger {
      animation: none !important;
      opacity: 1 !important;
      transform: rotate(-18deg) scale(1) !important;
      filter: none !important;
    }
    @keyframes slopradar-stamp-smash {
      0% {
        opacity: 0;
        transform: rotate(-28deg) scale(2.8) translateY(-40px);
        filter: blur(2px);
      }
      55% {
        opacity: 1;
        transform: rotate(-16deg) scale(0.92) translateY(4px);
        filter: blur(0);
      }
      72% {
        transform: rotate(-18deg) scale(1.06) translateY(0);
      }
      100% {
        opacity: 1;
        transform: rotate(-18deg) scale(1) translateY(0);
        filter: blur(0);
      }
    }
  `;
}

function stampHost(article: HTMLElement): HTMLElement {
  return (
    (article.closest('[data-testid="cellInnerDiv"]') as HTMLElement | null) ||
    article
  );
}

/**
 * Rubber-stamp smash. If `linger` is true, leave a bright SLOP mark on the post.
 */
export function playSlopStamp(
  article: HTMLElement,
  opts: { linger?: boolean; ms?: number } = {},
): Promise<void> {
  const { linger = false, ms = 650 } = opts;
  ensureStampStyles();

  const host = stampHost(article);
  if (getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }

  host.querySelector(`.${OVERLAY_CLASS}`)?.remove();

  const overlay = document.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `<div class="${MARK_CLASS}"><span>SLOP</span></div>`;
  host.appendChild(overlay);

  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (linger) {
        overlay.classList.add(`${OVERLAY_CLASS}--linger`);
        const mark = overlay.querySelector(`.${MARK_CLASS}`);
        mark?.classList.add(`${MARK_CLASS}--linger`);
      } else {
        overlay.remove();
      }
      resolve();
    }, ms);
  });
}
