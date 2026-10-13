import type { Label, Settings, Verdict } from "../shared/types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

function confidenceThreshold(strictness: number): number {
  // Higher strictness → lower bar to call something slop (hide more)
  return 0.85 - strictness * 0.3; // 0.85..0.55
}

function parseLabelJson(raw: string): { label: Label; confidence: number; reason: string } {
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
      parsed.label === "crypto" || parsed.label === "slop" || parsed.label === "unsure"
        ? parsed.label
        : "unsure";
    const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));
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
): Promise<string> {
  if (!settings.apiKey) {
    throw new Error("Missing API key");
  }

  const url = `${settings.apiBaseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages,
      response_format: { type: "json_object" },
    }),
  });

  const data = (await res.json()) as ChatCompletionResponse;
  if (!res.ok) {
    throw new Error(data.error?.message || `API ${res.status}`);
  }
  return data.choices?.[0]?.message?.content ?? "";
}

const TEXT_SYSTEM = `You classify X/Twitter posts for a crypto professional who wants a work-only feed.
Label "crypto" if the post is about crypto markets, protocols, trading, research, infra, regulation of crypto, or adjacent finance/tech that a crypto worker would need.
Label "slop" if it is entertainment, memes, jokes, celebrity, sports, dating, lifestyle flexing, or viral fluff unrelated to crypto work.
Label "unsure" only when truly ambiguous.
Reply with JSON only: {"label":"crypto"|"slop"|"unsure","confidence":0-1,"reason":"short"}`;

const VISION_SYSTEM = `You classify a tweet media frame for a crypto professional's work feed.
Label "crypto" if the image/video frame relates to crypto charts, protocols, on-chain data, market news, or work-relevant tech.
Label "slop" if it is a meme, joke, celebrity, sports, lifestyle, or entertainment content.
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
  } else if (parsed.label === "unsure") {
    // Fail open on unsure
    hide = false;
  } else {
    // Low confidence: fail open
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
  const content = await chatComplete(settings, settings.visionModel, [
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
  ]);
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
  if (!textVerdict) return shortText || hasMedia;
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
