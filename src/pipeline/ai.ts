import type { Label, Settings, Verdict } from "../shared/types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

function confidenceThreshold(strictness: number): number {
  return 0.85 - strictness * 0.3;
}

function parseLabelJson(raw: string): {
  label: Label;
  confidence: number;
  reason: string;
} {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { label: "unsure", confidence: 0.3, reason: "Unparseable model response" };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      label?: string;
      confidence?: number;
      reason?: string;
    };
    const label =
      parsed.label === "crypto" ||
      parsed.label === "slop" ||
      parsed.label === "unsure"
        ? parsed.label
        : "unsure";
    const confidence = Math.min(
      1,
      Math.max(0, Number(parsed.confidence) || 0.5),
    );
    const reason = typeof parsed.reason === "string" ? parsed.reason : "";
    return { label, confidence, reason };
  } catch {
    return { label: "unsure", confidence: 0.3, reason: "JSON parse failed" };
  }
}

async function chatComplete(
  settings: Settings,
  model: string,
  messages: ChatMessage[],
  opts: { jsonMode?: boolean } = {},
): Promise<string> {
  if (!settings.apiKey) {
    throw new Error("Missing API key");
  }

  const base = settings.apiBaseUrl.replace(/\/$/, "");
  const url = `${base}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.apiKey}`,
  };

  // OpenRouter recommends these; harmless for other OpenAI-compatible hosts
  if (base.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://x.com";
    headers["X-Title"] = "Twitter Slop Radar";
  }

  const body: Record<string, unknown> = {
    model,
    temperature: 0,
    messages,
  };
  if (opts.jsonMode !== false) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as ChatCompletionResponse;
  if (!res.ok) {
    throw new Error(data.error?.message || `API ${res.status}`);
  }
  return data.choices?.[0]?.message?.content ?? "";
}

const TEXT_SYSTEM = `You classify X/Twitter posts for a work-only feed.
KEEP (label "crypto") only if the post is about: cryptocurrency/web3, traditional finance/markets/macro, or cybersecurity/hacking/infosec/vulnerabilities/exploits.
HIDE (label "slop") if it is entertainment, films, sports, dating, looks/lifestyle, memes, celebrity, gossip, TikTok/Instagram fluff, or anything outside crypto/finance/cybersecurity.
Label "unsure" only when truly ambiguous.
Reply with JSON only: {"label":"crypto"|"slop"|"unsure","confidence":0-1,"reason":"short"}`;

const VISION_SYSTEM = `You classify a tweet media frame for a work-only feed.
KEEP (label "crypto") if the frame relates to crypto/markets charts, finance, or cybersecurity/hacking/technical security content.
HIDE (label "slop") if it is a meme, film/TV, sports, dating, looks, lifestyle, celebrity, TikTok/Instagram-style entertainment, or other fluff.
Look for watermarks (TikTok, Instagram, Reels) — those are usually slop.
Label "unsure" only when unclear.
Reply with JSON only: {"label":"crypto"|"slop"|"unsure","confidence":0-1,"reason":"short"}`;

function toVerdict(
  parsed: { label: Label; confidence: number; reason: string },
  settings: Settings,
  source: "text_ai" | "vision_ai",
): Verdict {
  const threshold = confidenceThreshold(settings.strictness);
  let hide = false;

  if (parsed.label === "slop" && parsed.confidence >= threshold) {
    hide = true;
  } else if (parsed.label === "crypto" && parsed.confidence >= threshold) {
    hide = false;
  } else {
    hide = false;
  }

  return {
    label: parsed.label,
    confidence: parsed.confidence,
    reason: parsed.reason || source,
    source,
    hide,
  };
}

export async function classifyText(
  text: string,
  handle: string,
  settings: Settings,
): Promise<Verdict> {
  const content = await chatComplete(settings, settings.textModel, [
    { role: "system", content: TEXT_SYSTEM },
    {
      role: "user",
      content: `Handle: @${handle}\nTweet:\n${text || "(empty)"}`,
    },
  ]);
  return toVerdict(parseLabelJson(content), settings, "text_ai");
}

export async function classifyVision(
  text: string,
  handle: string,
  imageDataUrl: string,
  settings: Settings,
): Promise<Verdict> {
  const content = await chatComplete(
    settings,
    settings.visionModel,
    [
      { role: "system", content: VISION_SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Handle: @${handle}\nTweet text:\n${text || "(little/no text — judge from image)"}`,
          },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    // Some OpenRouter vision routes are flaky with forced json_object
    { jsonMode: false },
  );
  return toVerdict(parseLabelJson(content), settings, "vision_ai");
}

export function needsVision(
  text: string,
  mediaKind: string,
  textVerdict: Verdict | null,
): boolean {
  const shortText = text.trim().length < 40;
  const hasMedia = mediaKind !== "none";
  if (!hasMedia) return false;
  if (!textVerdict) return true;
  if (textVerdict.label === "unsure") return true;
  if (shortText && textVerdict.confidence < 0.85) return true;
  return false;
}

export function failOpen(reason: string): Verdict {
  return {
    label: "unsure",
    confidence: 0,
    reason,
    source: "fail_open",
    hide: false,
  };
}
