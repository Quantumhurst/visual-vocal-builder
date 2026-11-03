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

Open http://localhost:3000, allow mic access, and speak.

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

## How it works

- Voice loop: Muse Voice Transcribe (STT only) → Muse Spark brain via the Meta Model API → CopilotKit `useCoAgent` shared state → canvas re-renders. Board interactions (e.g. clicking a table row) write shared state back without a new prompt.
- Live flow (no dead air while speaking): partial transcripts paint a *live preview* the instant a command is recognisable — "Pick Mars" lights the planet mid-sentence — through the same state appliers the agent uses (`lib/live-intent.ts`), and a natural pause auto-sends the turn (client endpointing), so Stop recording is optional. The Meta transcript + Muse Spark turn that follow confirm or correct the preview; grounded fact cards are never painted locally, only by the agent from the knowledge packs. Browsers with a built-in speech recogniser use it for interim words; the rest get periodic Muse Voice previews of the audio captured so far. The final Meta transcription is still the authority sent to the agent.
- Meta model choices (`lib/meta-models.ts`): brain is `muse-spark-1.3` (latest Spark, recommended for tight agentic tool loops — Muse Wonder targets long-horizon coding/computer use at higher latency, the wrong fit here); STT is `muse-voice-transcribe-1.0` with keyword biasing (Mars, Europa, section 85…) and English language bias in the realtime handshake, which previously went unused.
- Stack: Next.js + CopilotKit + AG-UI, with A2UI in contained mode. CopilotKit is the frontend SDK; the brain is Muse Spark. Spoken replies use the curated system voice (Meta has no TTS model): the app ranks the machine's English voices and speaks the host line with question/statement prosody. No voice model download.
- Pinned versions live in `package.json` + `package-lock.json`. Network destinations: the Meta Model API (agent brain + final transcripts), plus, in Chrome/Edge only, interim words from the browser's built-in speech recognition — a browser feature, not a Meta call and not local: the browser may send audio to its vendor's speech service. Final transcripts are always Meta.
- No OpenRouter, no CLI subscription session, no pre-existing project code or private service called at runtime.

## Demo beats

1. Jurisdiction comparison table (headline-level — enough to show the choice and why). Rows are fictional places (Mars, Europa, Andromeda Galaxy) with dummy values, for liability: nothing here resembles a real filing fact.
2. Draggable equity slider (splits total 100%, enforced both directions through the one shared-state update path in `lib/equity.ts`; invariant tests in `tests/equity.test.mjs`, run with `npm test`).
3. Filing checklist (guidance + grounded facts from the Corp Plan checklist pack; voice or click, never a filing).
4. Grounded s.85 rollover fact card (fact text and grounding — pack id + fact id — come from the Corp Plan s.85 pack in `lib/knowledge.ts`; ungrounded answers render no card).
5. "Send to a lawyer for a second opinion" — prepares a summary package (jurisdiction choice, equity split, checklist state) for the user to forward. The demo does NOT actually send email.

Day 2 catalog: fresh entries in `lib/catalog.ts` for the jurisdiction table, equity slider, filing checklist, and rollover fact card, all written in-window and driven by CopilotKit shared state (A2UI contained mode).

Day 3 catalog + knowledge extension (two components, both fresh in-window): a grounded filing-steps/fees knowledge pack (`corp-plan-filing-steps-fees-v1` in `lib/knowledge.ts`) rendered by the `FilingSteps` card (catalog `vvb-filing-steps-v1`) — pack text verbatim with pack/fact grounding, unknown ids show no card, every fee figure DEMO-labeled and fictional; and the lawyer-summary package display (catalog `vvb-lawyer-summary-v1`) — beat 5's package built by `lib/lawyer-summary.ts` from shared state and rendered on the canvas whether prepared by button or by the agent action `prepareLawyerSummary`. Prep only; no send path. Tests in `tests/day3.test.mjs` (12/12 with the Day 2 suite).

## Follow-ups

- CopilotKit v2 migration.
- Shared rate-limit store (e.g. Upstash/Redis) instead of per-instance in-memory counts.

## Provenance

Built from October 27, 2026, during the hackathon window. It does not include or call any pre-existing project code or private service.

Open-source libraries, Next.js, CopilotKit, PixiJS, and the rest in THIRD-PARTY-NOTICES.md, are used as libraries. This work was built with Muse agent assistance, Nuntuk, within the same window, under my direction.

## Credits

<img src="public/nuntuk-avatar.webp" alt="Nuntuk — a shrew wearing headphones, wraparound sunglasses, and a chunky gold chain" width="120" />

Built with Muse (Nuntuk) — the agent that built this entry under the owner's direction. The owner owns the repo and all rights to the work.

Note: the GitHub commit badge reads Quantumhurst because the push tool carries no author field; this image and credit line are where Muse's face and name appear.

## License

MIT. See LICENSE.
