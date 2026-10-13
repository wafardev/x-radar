import type { Verdict } from "../shared/types";
import { hideTargetFor } from "./extract";

const ATTR = "data-slopradar";
const HIDDEN = "hidden";
const KEPT = "kept";
const PENDING = "pending";

export type HideListener = (tweetId: string, hidden: boolean) => void;

const hideStack: string[] = [];
const listeners = new Set<HideListener>();

export function onHideChange(listener: HideListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(tweetId: string, hidden: boolean): void {
  for (const l of listeners) l(tweetId, hidden);
}

export function getHiddenCount(): number {
  return document.querySelectorAll(`[${ATTR}="${HIDDEN}"]`).length;
}

export function markPending(article: HTMLElement): void {
  const target = hideTargetFor(article);
  if (!target.getAttribute(ATTR)) {
    target.setAttribute(ATTR, PENDING);
  }
}

export function applyVerdict(
  article: HTMLElement,
  tweetId: string,
  verdict: Verdict,
): void {
  const target = hideTargetFor(article);
  article.setAttribute("data-slopradar-id", tweetId);
  article.setAttribute("data-slopradar-source", verdict.source);
  article.setAttribute("data-slopradar-label", verdict.label);
  article.setAttribute("data-slopradar-reason", verdict.reason);

  if (verdict.hide) {
    target.setAttribute(ATTR, HIDDEN);
    if (!hideStack.includes(tweetId)) hideStack.push(tweetId);
    notify(tweetId, true);
  } else {
    target.setAttribute(ATTR, KEPT);
    const idx = hideStack.indexOf(tweetId);
    if (idx >= 0) hideStack.splice(idx, 1);
    notify(tweetId, false);
  }
}

export function undoLastHide(): string | null {
  const tweetId = hideStack.pop() ?? null;
  if (!tweetId) return null;

  const article = document.querySelector<HTMLElement>(
    `article[data-slopradar-id="${tweetId}"]`,
  );
  if (!article) return tweetId;

  const target = hideTargetFor(article);
  target.setAttribute(ATTR, KEPT);
  notify(tweetId, false);
  return tweetId;
}

export function revealAll(): void {
  for (const el of document.querySelectorAll(`[${ATTR}="${HIDDEN}"]`)) {
    el.setAttribute(ATTR, KEPT);
  }
  hideStack.length = 0;
  notify("", false);
}
