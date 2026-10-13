import type { Settings, Verdict } from "../shared/types";

const CRYPTO_WEIGHT = 1.2;
const SLOP_WEIGHT = 1.0;

function countHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    if (kw.startsWith("$")) {
      const re = new RegExp(`(?:^|\\s|[^a-z0-9])\\${kw}\\b`, "i");
      if (re.test(lower)) hits += 1;
      continue;
    }
    if (lower.includes(kw)) hits += 1;
  }
  return hits;
}

export function scoreKeywords(
  text: string,
  settings: Settings,
): { cryptoHits: number; slopHits: number; score: number } {
  const cryptoHits = countHits(text, settings.cryptoKeywords);
  const slopHits = countHits(text, settings.slopKeywords);
  const score = cryptoHits * CRYPTO_WEIGHT - slopHits * SLOP_WEIGHT;
  return { cryptoHits, slopHits, score };
}

/**
 * Denylist is hard: any slop keyword hit hides unless crypto signals outweigh it.
 * Strictness only matters when both crypto and slop keywords are present.
 */
export function keywordVerdict(
  text: string,
  settings: Settings,
): Verdict | null {
  const { cryptoHits, slopHits, score } = scoreKeywords(text, settings);

  if (slopHits === 0 && cryptoHits === 0) return null;

  if (slopHits >= 1 && cryptoHits === 0) {
    return {
      label: "slop",
      confidence: Math.min(0.99, 0.85 + slopHits * 0.05),
      reason: `Slop keyword hit (${slopHits})`,
      source: "keyword_slop",
      hide: true,
    };
  }

  if (cryptoHits >= 1 && slopHits === 0) {
    return {
      label: "crypto",
      confidence: Math.min(0.99, 0.85 + cryptoHits * 0.05),
      reason: `Keep keyword hit (${cryptoHits})`,
      source: "keyword_crypto",
      hide: false,
    };
  }

  const margin = 0.4 - settings.strictness * 0.8;
  if (score <= margin) {
    return {
      label: "slop",
      confidence: Math.min(0.95, 0.7 + slopHits * 0.08),
      reason: `Mixed keywords → slop (score ${score.toFixed(2)})`,
      source: "keyword_slop",
      hide: true,
    };
  }

  return {
    label: "crypto",
    confidence: Math.min(0.95, 0.7 + cryptoHits * 0.08),
    reason: `Mixed keywords → keep (score ${score.toFixed(2)})`,
    source: "keyword_crypto",
    hide: false,
  };
}

export function accountVerdict(
  handle: string,
  settings: Settings,
): Verdict | null {
  const h = handle.trim().replace(/^@/, "").toLowerCase();
  if (!h) return null;

  if (settings.allowHandles.includes(h)) {
    return {
      label: "crypto",
      confidence: 1,
      reason: `Allowlisted @${h}`,
      source: "account_allow",
      hide: false,
    };
  }

  if (settings.blockHandles.includes(h)) {
    return {
      label: "slop",
      confidence: 1,
      reason: `Blocklisted @${h}`,
      source: "account_block",
      hide: true,
    };
  }

  return null;
}
