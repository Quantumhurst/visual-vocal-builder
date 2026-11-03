# Visual Vocal Builder

Incorporate a company by voice: a Meta AI hackathon entry where spoken words paint an interactive canvas — compare jurisdictions, split equity with a slider, and walk a filing checklist, all by voice.

> **Demo data only. This is not legal advice, not a filing, and nothing here is submitted to any registry.**

## Run it locally

Requirements: Node 20.9+ and npm, Git, a Meta Model API key.

```bash
git clone https://github.com/Quantumhurst/visual-vocal-builder.git
cd visual-vocal-builder
npm install
cp .env.example .env   # fill in META_API_KEY (never commit .env)
npm run dev
```

Open http://localhost:3000, click **Enter the Bridge**, then press **TALK** (or Space), allow mic access, and speak.

`/api/transcribe` accepts only raw PCM16, 16 kHz mono. Arbitrary webm/wav uploads no longer work. To test-upload from a wav file:

```bash
ffmpeg -i in.wav -ac 1 -ar 16000 -f s16le out.pcm
curl -F "audio=@out.pcm;type=audio/L16" http://localhost:3000/api/transcribe
```

Check the code with:

```bash
npm test
npm run typecheck
```

Tests import TypeScript sources directly and need Node 22.18+ for type stripping; the app itself runs on Node 20.9+.

## How it works

- Voice loop: Muse Voice Transcribe (STT only) → Muse Spark brain via the Meta Model API → CopilotKit `useCoAgent` shared state → canvas re-renders. Board interactions (e.g. clicking a table row) write shared state back without a new prompt.
- Live flow (no dead air while speaking): partial transcripts paint a *live preview* the instant a command is recognisable — "Pick Mars" lights the planet mid-sentence — through the same state appliers the agent uses (`lib/live-intent.ts`), and a natural pause auto-sends the turn (client endpointing), so Stop recording is optional. The final Meta transcript is still the authority. Clear deterministic commands (jurisdiction, equity/owner count, checklist counts, summary) are confirmed locally from that transcript and speak a local host line, so they do not wait for the model; questions and ambiguous turns still go to Muse Spark. Equity/owner changes now pause on a confirmation card before the walk advances. Grounded fact cards are never painted locally, only by the agent from the knowledge packs. Browsers with a built-in speech recogniser use it for interim words; other browsers get no interim words, just the final Meta transcript.
- Landing: `/` opens on a persistent Orbital Foundry landing screen — the orb with a contained cyan spin ring, the "Incorporate a company by voice" tagline, the demo-data disclaimer, and one **Enter the Bridge** button. The ring lives in the orb's own box (not a fixed overlay), so it cannot cover the wordmark or copy. Clicking Enter mounts the cockpit on the same route (no new page) and leaves the mic closed; you press **TALK** when you are ready. The same contained spin ring wraps the cockpit HUD's top-left brand orb.
- First Speak: the first **TALK** press (Space also works) speaks the same home-base question the objective already shows ("Pick your home base — Mars, Europa, or Andromeda Galaxy?") once, then opens the mic. Later TALK presses do not repeat it. Enter alone does not speak or record; the sessionStorage marker gates the TALK path. The greeting writes no shared state and adds no fact.
- Meta model choices (`lib/meta-models.ts`): brain is `muse-spark-1.3` (latest Spark, recommended for tight agentic tool loops — Muse Wonder targets long-horizon coding/computer use at higher latency, the wrong fit here); STT is `muse-voice-transcribe-1.0` with keyword biasing (Mars, Europa, section 85, owner counts, founder names, and fast-lane commands) and English language bias in the realtime handshake, which previously went unused. The fixed "is this actually going to file my company?" guard answer is answered locally (`lib/filing-guard.ts`), with no model turn and no state change.
- Stack: Next.js + CopilotKit + AG-UI, with A2UI in contained mode. CopilotKit is the frontend SDK; the brain is Muse Spark. Spoken replies use the curated system voice (Meta has no TTS model): the app ranks the machine's English voices and speaks the host line with question/statement prosody. No voice model download. A **HOST VOICE** picker in Controls can pin a curated English browser/OS voice (stored by `voiceURI` in `localStorage`); a fresh session defaults to **Karen** when the OS exposes her, while **Auto** keeps the curated best-available pick. Novelty, low-confidence, and network-only voices are hidden because several of them are silent in Chrome; a stale or unreliable saved voice falls back to Karen (or Auto if Karen is unavailable) and is cleared. The talk bar shows a gold **VOX OFF** chip when muted, and a failed utterance writes a visible host-voice notice.
- Required-task handoff: when a change completes a required beat, the cockpit opens the next one in the same handler — equity completion opens the five-step BUILD queue **after the split is confirmed, explicitly or implicitly by the next command**, and 5/5 opens LAUNCH. Clicking a build step updates the visible host line with the real count and the next step name, so the spoken question has visible answers instead of leaving the previous task's line on screen.
- Pinned versions live in `package.json` + `package-lock.json`. Network destinations: the Meta Model API (agent brain + final transcripts), plus, in Chrome/Edge only, interim words from the browser's built-in speech recognition — a browser feature, not a Meta call and not local: the browser may send audio to its vendor's speech service. Final transcripts are always Meta. Voice-out uses the browser speechSynthesis and the OS voice; the app makes no voice-network call itself, but a selected system voice may be a network voice provided by the browser/OS.
- No OpenRouter, no CLI subscription session, no pre-existing project code or private service called at runtime.

## Demo beats

The page opens on the Orbital Foundry landing screen; **Enter the Bridge** swaps to the cockpit without starting the mic. Press **TALK** to start the voice loop before beat 1.

1. Jurisdiction comparison (headline-level — enough to show the choice and why). Rows are fictional places (Mars, Europa, Andromeda Galaxy) with dummy values, for liability: nothing here resembles a real filing fact. Picking one plays a short rocket-travel cinematic before the colony view.
2. Equity split for **1–5 owners**: a count control (growing defaults to an equal split, shrinking redistributes), draggable crew bars, and a hard 100% invariant enforced through the one shared-state update path in `lib/equity.ts` (invariant tests in `tests/equity.test.mjs`). Every owner/equity change shows a **CONFIRM CREW SPLIT** card with the normalized split; Confirm (or "yes") opens BUILD. Repeating the same owner count also confirms, and issuing another command accepts the visible split and keeps the walk moving instead of re-asking. "Change"/"no" keeps the card open for another owner count or slider drag. A short post-speech pause prevents the mic from hearing the host's own confirmation line.
3. Filing checklist (guidance + grounded facts from the Corp Plan checklist pack; voice or click, never a filing). The build mission stays current until **5/5** structures are up, so a partly built colony cannot silently advance the walk. While BUILD is the current objective, the left rail shows the five steps and the running **0/5 → 5/5** count with the next step highlighted; clicking a step uses the same `updateChecklistItem` path as the full checklist and updates the host line. At 5/5 the cockpit hands off to LAUNCH.
4. Grounded s.85 rollover and filing-steps/fees cards are **optional archive systems**, not required missions. The cockpit keeps the four required missions (HOME, CREW, BUILD, LAUNCH) in the open and tucks the optional S.85 / FEES tabs into a collapsed Archive, with the detailed plan and example chips behind disclosures. Fact text and grounding (pack id + fact id) come from the packs in `lib/knowledge.ts`, and ungrounded answers render no card. The required walk is jurisdiction → equity (1–5 owners) → build 5/5 → lawyer summary; the company callsign appears only at 5/5.
5. "Send to a lawyer for a second opinion" — prepares a summary package (jurisdiction choice, equity split, checklist state) for the user to forward. The demo does NOT actually send email. Before 5/5 the package says the company name is not chosen yet.

Day 2 catalog: fresh entries in `lib/catalog.ts` for the jurisdiction table, equity slider, filing checklist, and rollover fact card, all written in-window and driven by CopilotKit shared state (A2UI contained mode).

Day 3 catalog + knowledge extension (two components, both fresh in-window): a grounded filing-steps/fees knowledge pack (`corp-plan-filing-steps-fees-v1` in `lib/knowledge.ts`) rendered by the `FilingSteps` card (catalog `vvb-filing-steps-v1`) — pack text verbatim with pack/fact grounding, unknown ids show no card, every fee figure DEMO-labeled and fictional; and the lawyer-summary package display (catalog `vvb-lawyer-summary-v1`) — beat 5's package built by `lib/lawyer-summary.ts` from shared state and rendered on the canvas whether prepared by button or by the agent action `prepareLawyerSummary`. Prep only; no send path. Tests in `tests/day3.test.mjs` (12/12 with the Day 2 suite).

## Follow-ups

- CopilotKit v2 migration.
- Shared rate-limit store (e.g. Upstash/Redis) instead of per-instance in-memory counts.

## Provenance & Hackathon Disclosure

### Meta Global AI Developer Hackathon
- **Problem Statement:** Build for Your World / Push the Frontier — Voice-driven spatial interface transforming complex corporate planning into a hands-free, visual, interactive canvas.
- **Meta Models Incorporated:**
  - **Muse Voice Transcribe (`muse-voice-transcribe-1.0`)**: Realtime streaming speech-to-text with WebSocket chunk pacing, keyword biasing (fictional jurisdictions, founder names, legal concepts), and English language biasing via Meta Model API.
  - **Muse Spark (`muse-spark-1.3`)**: Cognitive agent brain driving multi-turn tool calling, invariant validation, and co-agent state synchronization via Meta Model API.
- **Code & Planning Disclosure:**
  - Written planning and high-level architectural design were developed prior to the event; zero code, datasets, or UI components were carried over.
  - All application code, styles, tests, and documentation in this repository were authored from scratch during the hackathon window starting on October 27, 2026.
  - Does not call or rely on any pre-existing private services.
  - Built with Muse agent assistance (Nuntuk) under direct developer guidance.

## Credits

<img src="public/nuntuk-avatar.webp" alt="Nuntuk — a shrew wearing headphones, wraparound sunglasses, and a chunky gold chain" width="120" />

Built with Muse (Nuntuk) — the agent that built this entry under the owner's direction. The owner owns the repo and all rights to the work.

Note: the GitHub commit badge reads Quantumhurst because the push tool carries no author field; this image and credit line are where Muse's face and name appear.

## License

MIT. See LICENSE.
