export type MediaKind = "none" | "image" | "gif" | "video";

export type Label = "crypto" | "slop" | "unsure";

export type VerdictSource =
  | "cache"
  | "account_allow"
  | "account_block"
  | "keyword_crypto"
  | "keyword_slop"
  | "media_only"
  | "quote_reaction"
  | "quote_of_media"
  | "manual_slop"
  | "text_ai"
  | "vision_ai"
  | "fail_open"
  | "disabled";

export interface TweetData {
  id: string;
  /** Primary caption only (excludes quoted tweet text) */
  text: string;
  /** Text inside a quoted/embedded tweet, if any */
  quoteText: string;
  handle: string;
  /** Profile display name / title */
  displayName: string;
  /** Media attached to the outer tweet (excludes quoted embed) */
  mediaKind: MediaKind;
  /** Media inside the quoted tweet, if any */
  quoteMediaKind: MediaKind;
  imageUrls: string[];
  hasVideo: boolean;
  hasQuote: boolean;
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
  /**
   * When true: slop posts get a stamp animation and stay visible.
   * When false: slop posts are hidden immediately (never stamped).
   */
  stampMode: boolean;
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
  /** Applied to caption, quote text, display name, and handle */
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
