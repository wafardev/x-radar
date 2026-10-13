# Twitter Slop Radar

Chrome MV3 extension that filters your X/Twitter timeline into a **crypto-work feed**. Entertainment, memes, and lifestyle posts get hidden; markets, protocols, and research stay visible.

## How it works

Classification is tiered (cheap → expensive):

1. **Accounts** — allowlist always keeps, blocklist always hides
2. **Keywords** — crypto positive terms vs slop negative terms
3. **Text AI** — OpenAI-compatible chat model for ambiguous posts
4. **Vision AI** — image or mid-video frame when text is thin / unsure

AI calls go through the background service worker so your API key never sits in the page. Failures **fail open** (tweet stays visible). Verdicts are cached by tweet id for the browser session.

## Install (load unpacked)

```bash
npm install
npm run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `dist/` folder
4. Pin the extension, open the popup, paste an API key, click **Save**
5. Refresh `https://x.com` / `https://twitter.com`

## Configure

| Setting | Purpose |
| --- | --- |
| Enabled | Master on/off |
| Passthrough | Still classify/log, but never hide |
| Base URL | OpenAI-compatible endpoint (`https://api.openai.com/v1`, OpenRouter, Groq, etc.) |
| API key | Stored in `chrome.storage.sync` / used only from the service worker |
| Text / vision model | Defaults to `gpt-4o-mini` |
| Strictness | Higher = hide more borderline slop |
| Allow / block handles | One per line, with or without `@` |
| Keyword lists | Comma or newline separated |

On the timeline, a floating chip shows **N hidden · undo** for the last false positive.

## Develop

```bash
npm run dev
```

Then load the unpacked `dist/` folder (CRXJS rebuilds on change). Revisit X after rebuilds.

## Notes / limits

- DOM-only: filters what you already see. No Twitter API scraping.
- X changes `data-testid` / markup often — selectors live in `src/content/extract.ts`.
- Video frame capture needs a decoded `<video>`; if seek fails we fall back to poster/images.
- Without an API key, only account + keyword tiers run.

## Privacy

Tweets (and occasional media frames) are sent to the AI endpoint **you** configure when local rules are inconclusive. Prefer a provider you trust; clear the API key to stay local-only.
