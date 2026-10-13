import { DEFAULT_SETTINGS, EMPTY_STATS } from "./defaults";
import type { Settings, SessionStats, Verdict } from "./types";

const SETTINGS_KEY = "slopradar_settings";
const API_KEY_KEY = "slopradar_api_key";
const STATS_KEY = "slopradar_stats";
const CACHE_KEY = "slopradar_cache";

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

function normalizeKeywordList(list: string[]): string[] {
  return list
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .filter((k, i, arr) => arr.indexOf(k) === i);
}

type LegacyPartial = Partial<Settings> & { nameKeywords?: string[] };

export function normalizeSettings(partial?: LegacyPartial): Settings {
  const legacyNames = partial?.nameKeywords ?? [];
  const merged: Settings = { ...DEFAULT_SETTINGS, ...partial };
  return {
    ...merged,
    stampMode: merged.stampMode ?? false,
    hideNoTextImage: merged.hideNoTextImage ?? true,
    hideNoTextGif: merged.hideNoTextGif ?? true,
    hideNoTextVideo: merged.hideNoTextVideo ?? true,
    allowHandles: (merged.allowHandles ?? []).map(normalizeHandle).filter(Boolean),
    blockHandles: (merged.blockHandles ?? []).map(normalizeHandle).filter(Boolean),
    cryptoKeywords: normalizeKeywordList(
      merged.cryptoKeywords ?? DEFAULT_SETTINGS.cryptoKeywords,
    ),
    slopKeywords: normalizeKeywordList([
      ...(merged.slopKeywords ?? DEFAULT_SETTINGS.slopKeywords),
      ...legacyNames,
    ]),
    strictness: Math.min(1, Math.max(0, merged.strictness ?? 0.5)),
    apiBaseUrl: (merged.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(
      /\/$/,
      "",
    ),
  };
}

type StoredSettings = Omit<Settings, "apiKey">;

export async function loadSettings(): Promise<Settings> {
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_KEY),
    chrome.storage.local.get(API_KEY_KEY),
  ]);
  const stored = syncResult[SETTINGS_KEY] as Partial<StoredSettings> | undefined;
  const apiKey = (localResult[API_KEY_KEY] as string | undefined) ?? "";
  return normalizeSettings({ ...stored, apiKey });
}

export async function saveSettings(settings: Settings): Promise<void> {
  const normalized = normalizeSettings(settings);
  const { apiKey, ...rest } = normalized;
  await Promise.all([
    chrome.storage.sync.set({ [SETTINGS_KEY]: rest }),
    chrome.storage.local.set({ [API_KEY_KEY]: apiKey }),
  ]);
}

export async function loadStats(): Promise<SessionStats> {
  const result = await chrome.storage.session.get(STATS_KEY);
  return { ...EMPTY_STATS, ...(result[STATS_KEY] as SessionStats | undefined) };
}

export async function saveStats(stats: SessionStats): Promise<void> {
  await chrome.storage.session.set({ [STATS_KEY]: stats });
}

export async function resetStats(): Promise<SessionStats> {
  await chrome.storage.session.set({ [STATS_KEY]: EMPTY_STATS });
  return { ...EMPTY_STATS };
}

export async function bumpStat(
  key: keyof SessionStats,
  by = 1,
): Promise<SessionStats> {
  const stats = await loadStats();
  stats[key] += by;
  await saveStats(stats);
  return stats;
}

type CacheMap = Record<string, Verdict>;

export async function getCachedVerdict(tweetId: string): Promise<Verdict | null> {
  const result = await chrome.storage.session.get(CACHE_KEY);
  const cache = (result[CACHE_KEY] as CacheMap | undefined) ?? {};
  return cache[tweetId] ?? null;
}

export async function setCachedVerdict(
  tweetId: string,
  verdict: Verdict,
): Promise<void> {
  const result = await chrome.storage.session.get(CACHE_KEY);
  const cache = (result[CACHE_KEY] as CacheMap | undefined) ?? {};
  cache[tweetId] = verdict;

  const ids = Object.keys(cache);
  if (ids.length > 500) {
    for (const id of ids.slice(0, ids.length - 400)) {
      delete cache[id];
    }
  }

  await chrome.storage.session.set({ [CACHE_KEY]: cache });
}

export async function clearVerdictCache(): Promise<void> {
  await chrome.storage.session.remove(CACHE_KEY);
}

const STAMP_KEY = "slopradar_stamped";

type StampMap = Record<string, true>;

export async function isTweetStamped(tweetId: string): Promise<boolean> {
  const result = await chrome.storage.local.get(STAMP_KEY);
  const map = (result[STAMP_KEY] as StampMap | undefined) ?? {};
  return Boolean(map[tweetId]);
}

export async function stampTweetId(tweetId: string): Promise<void> {
  const result = await chrome.storage.local.get(STAMP_KEY);
  const map = (result[STAMP_KEY] as StampMap | undefined) ?? {};
  map[tweetId] = true;
  const ids = Object.keys(map);
  if (ids.length > 2000) {
    for (const id of ids.slice(0, ids.length - 1500)) {
      delete map[id];
    }
  }
  await chrome.storage.local.set({ [STAMP_KEY]: map });
}

export function parseHandleList(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map(normalizeHandle)
    .filter(Boolean);
}

export function parseKeywordList(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}
