export type MediaKind = "none" | "image" | "gif" | "video";

export type Label = "crypto" | "slop" | "unsure";

export type VerdictSource =
  | "cache"
  | "account_allow"
  | "account_block"
  | "keyword_crypto"
  | "keyword_slop"
  | "media_only"
  | "text_ai"
  | "vision_ai"
  | "fail_open"
  | "disabled"
  | "passthrough";

export interface TweetData {
  id: string;
  text: string;
  handle: string;
  mediaKind: MediaKind;
  imageUrls: string[];
  hasVideo: boolean;
}

export interface Verdict {
  label: Label;
  confidence: number;
  reason: string;
  source: VerdictSource;
  hide: boolean;
}

export interface Settings {
  enabled: boolean;
  passthrough: boolean;
  /** Hide image posts with no text */
  hideNoTextImage: boolean;
  /** Hide GIF posts with no text */
  hideNoTextGif: boolean;
  /** Hide video posts with no text */
  hideNoTextVideo: boolean;
  apiBaseUrl: string;
  apiKey: string;
  textModel: string;
  visionModel: string;
  strictness: number;
  allowHandles: string[];
  blockHandles: string[];
  cryptoKeywords: string[];
  slopKeywords: string[];
}

export interface SessionStats {
  classified: number;
  hidden: number;
  aiCalls: number;
  visionCalls: number;
}

export type Message =
  | { type: "CLASSIFY_TEXT"; tweetId: string; text: string; handle: string }
  | {
      type: "CLASSIFY_VISION";
      tweetId: string;
      text: string;
      handle: string;
      imageDataUrl: string;
    }
  | { type: "GET_SETTINGS" }
  | { type: "GET_STATS" }
  | { type: "RESET_STATS" }
  | { type: "GET_CACHE"; tweetId: string }
  | { type: "SET_CACHE"; tweetId: string; verdict: Verdict }
  | { type: "UNDO_LAST_HIDE" }
  | { type: "SETTINGS_UPDATED" };

export type MessageResponse =
  | { ok: true; verdict: Verdict }
  | { ok: true; settings: Settings }
  | { ok: true; stats: SessionStats }
  | { ok: true; verdict: Verdict | null }
  | { ok: true }
  | { ok: false; error: string };
