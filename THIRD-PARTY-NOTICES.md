# Third-party notices

The MIT `LICENSE` file in this repo covers the owner's own code only. It does
not cover the third-party packages and fonts below. This file lists the
direct third-party stack used by the app, with each item's license as stated
in its installed package (or, for the fonts, its upstream source). Versions
are the versions installed in the current tree — see `package.json` and
`package-lock.json`.

## Direct dependencies

| Package | Version | License | Source |
| --- | --- | --- | --- |
| Next.js | 16.4.3 | MIT | https://nextjs.org |
| React | 19.3.1 | MIT | https://react.dev/ |
| React DOM | 19.3.1 | MIT | https://react.dev/ |
| CopilotKit react-core | 1.81.0 | MIT | https://github.com/CopilotKit/CopilotKit |
| CopilotKit react-ui | 1.81.0 | MIT | https://github.com/CopilotKit/CopilotKit |
| CopilotKit runtime | 1.81.0 | MIT | https://github.com/CopilotKit/CopilotKit |
| AG-UI client (via CopilotKit) | 1.0.2 | MIT | https://github.com/ag-ui-protocol/ag-ui |
| AG-UI core (via CopilotKit) | 1.0.2 | MIT | https://github.com/ag-ui-protocol/ag-ui |
| A2UI web_core (via CopilotKit) | 0.10.4 | Apache-2.0 | https://a2ui.org/ |
| openai | 7.45.1 | Apache-2.0 | https://github.com/openai/openai-node |
| AI SDK OpenAI provider (`@ai-sdk/openai`, Meta brain client) | 3.0.132 | Apache-2.0 | https://github.com/vercel/ai |
| AI SDK Google provider (`@ai-sdk/google`, Gemini brain client) | 3.0.139 | Apache-2.0 | https://github.com/vercel/ai |
| pixi.js | 8.22.0 | MIT | https://pixijs.com/ |
| canvas-confetti | 1.9.4 | ISC | https://github.com/catdad/canvas-confetti |
| lenis | 1.3.27 | MIT | https://github.com/darkroomengineering/lenis |
| ws | 8.22.0 | MIT | https://github.com/websockets/ws |
| puppeteer-core (headset walk, dev-only) | 25.16.0 | Apache-2.0 | https://github.com/puppeteer/puppeteer |
| Tailwind CSS | 4.3.3 | MIT | https://tailwindcss.com |
| TypeScript | 5.9.3 | Apache-2.0 | https://www.typescriptlang.org/ |
| ESLint | 9.39.5 | MIT | https://eslint.org |
| Geist + Geist Mono fonts (via `next/font/google`) | — (served by Next.js at build time, not versioned here) | SIL Open Font License 1.1 | https://github.com/vercel/geist-font |

Notes on the fonts: Geist and Geist Mono are loaded by `app/layout.tsx`
through `next/font/google`. They are not bundled in this repo; their license
(SIL Open Font License, Version 1.1) is as stated by the upstream Geist
repository.

Artwork: `public/nuntuk-avatar.webp` is an original avatar created for this entry during the hackathon window; no third-party image asset is incorporated.

## Transitive dependencies

Transitive dependencies are not listed individually here. Their licenses live
in their own packages (inside `node_modules`, which is not committed to this
repo) — see each package's `package.json` `license` field and its bundled
license file for the full text.

## Keeping this file current

If a package above is upgraded, update its version and license here to match
the newly installed package. This file asserts only license identifiers, not
a restatement of license terms; the full license texts ship with their
packages (or, for the fonts, with the upstream Geist repository).
