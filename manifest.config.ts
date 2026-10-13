import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Twitter Slop Radar",
  description:
    "Filter X/Twitter into a crypto-work feed. Hide entertainment slop; keep markets and research.",
  version: "1.2.3",
  action: {
    default_popup: "src/popup/index.html",
    default_title: "Slop Radar",
    default_icon: {
      "16": "public/icons/icon16.png",
      "48": "public/icons/icon48.png",
      "128": "public/icons/icon128.png",
    },
  },
  background: {
    service_worker: "src/background/sw.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://x.com/*", "https://twitter.com/*"],
      js: ["src/content/main.ts"],
      css: ["src/content/styles.css"],
      run_at: "document_idle",
    },
  ],
  permissions: ["storage"],
  host_permissions: [
    "https://x.com/*",
    "https://twitter.com/*",
    "https://openrouter.ai/*",
    "https://*/*",
  ],
  icons: {
    "16": "public/icons/icon16.png",
    "48": "public/icons/icon48.png",
    "128": "public/icons/icon128.png",
  },
});
