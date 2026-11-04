# Visual Vocal Builder

Build a fictional colony and incorporate a fictional company by voice, hands-free. Spoken words move an orbital foundry world: pick a home base, split equity, raise five structures, approve the company name, learn one grounded section 85 fact, and prepare a lawyer summary. A founder who cannot use a mouse, keyboard, or pointer can finish the whole journey on a headset.

> **Demo data only. This is not legal advice, not a filing, and nothing here is submitted to any registry.**

## Run it locally

Requirements: Node 20.9+ and npm, Git, a Meta Model API key.

```bash
git clone https://github.com/Quantumhurst/visual-vocal-builder.git
cd visual-vocal-builder
npm install
cp .env.example .env   # fill in META_API_KEY (never commit .env)
node server.mjs        # unified Next + ASR WebSocket server on :3000
```

Open http://localhost:3000 and allow the microphone once. The landing page listens; say **“Enter the bridge”**. The cockpit opens the conversation and the mic itself — there is no TALK button to press. The visible button is only a fallback.

The unified server matters: `/api/asr-stream` is a WebSocket owned by `server.mjs`. Plain `next dev` serves the page but returns 405 for that socket, so live turns fall back to buffered audio (still usable, but slower).

`/api/transcribe` accepts only raw PCM16, 16 kHz mono. Arbitrary webm/wav uploads no longer work. To test-upload from a wav file:

```bash
ffmpeg -i in.wav -ac 1 -ar 16000 -f s16le out.pcm
curl -F "audio=@out.pcm;type=audio/L16" http://localhost:3000/api/transcribe
```

Check the code with:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Run the voice-only headset walk (real audio in, no clicks, no injected text):

```bash
node scripts/headset-walk.mjs
```

It synthesizes a user voice with macOS `say`, feeds the waveform into a virtual microphone, lets the app's own AudioWorklet and Meta transcript path drive every step, and verifies the board, host line, and no-click count at each beat. It also checks caption/audio agreement on every host line, the single SAY cue per mission, a two-part slow-speech turn (the first final is held and merged), host-audio silence recovery, and no-speech recovery. Results land in `proof/headset-walk.json` (ignored by git) and screenshots in `.shots/`.

Tests import TypeScript sources directly and need Node 22.18+ for type stripping; the app itself runs on Node 20.9+.

## How it works

- **Voice in:** Muse Voice Transcribe streams partials for live painting and sends an authoritative final transcript. A buffered `/api/transcribe` fallback retries the same audio when a streamed turn goes empty or silent, so a turn is not dropped. The brain is Muse Spark via the Meta Model API; deterministic commands take a local fast lane through the same state appliers.
- **Voice out:** the curated system voice speaks every host line. Host speech is logged, replayable with “repeat that”, and never treated as user speech: the mic is gated during playback and a lexical echo filter tombstones self-echo. The mic reopens automatically after the host finishes.
- **Voice-only entry:** the landing page listens for “Enter the bridge” (or “Resume” / “Start over” when a run is saved). Crossing the bridge mounts the cockpit and starts the conversation without a click.
- **Always-available controls:** say **help**, **repeat that**, **stop**, **slower**, **faster**, **louder**, **quieter**, **volume 40**, **mute/unmute**, **show/hide transcript**, **save progress**, **start over**, **status**, **test voice**, **slow mode**, or **take your time**. All are parsed locally, before any model turn, in every state. “Stop” silences the host but keeps the mic listening for “continue”. The cockpit shows HOST AUDIO READY/SPEAKING/OFF/SILENT; if a voice never starts, it retries the system default once and then says so visibly rather than continuing in silence.
- **Six required beats, in order:** home base → crew split (confirmed) → five structures → company-name approval → one grounded s.85 rollover fact → lawyer summary. The name is approved only after 5/5, and the s.85 card is required; the filing-steps/fees card remains the one optional archive system.
- **Grounded facts only:** s.85 content is verbatim pack text (`lib/knowledge.ts`), with pack id and fact id on the card and a separate verifier checking it. The host reads one grounded sentence; the card carries the rest. Nothing legal is invented in prose.
- **Live captions are the primary channel:** the HOST line and the HEARD line are always visible, large and high-contrast, directly above the controls, and the full caption history stays open in the mission rail. The HOST caption is the exact capped line the speech engine receives — never an uncapped agent reply running alongside a shortened utterance. The transcript modal remains as an expanded view, not the only way to read the run.
- **One clear next step:** every required mission shows exactly one SAY cue and at most one fallback chip. The host asks for the same single step; alternate phrasings remain understood by voice but are not presented as a menu.
- **Audio/visual agreement:** a local line is painted before it is spoken (two animation frames), and a new host line replaces the old utterance instead of queueing behind audio the caption no longer shows. Spoken lines are logged by the speech path itself, so the history never records the provisional fallback question an agent turn shows while thinking.
- **Turn-taking that survives slow speech:** the mic reopens after every host line. A recognizer final that is visibly unfinished ("The planet I want is …") is held, the mic stays open, and the next final is merged into one command; nothing half-formed is sent as a whole turn. The utterance cap is 55 seconds, and slow mode uses a longer local pause window.
- **Recovery, not stalls:** a dropped turn, silent host, lost live socket, or a long silent LISTENING turn surfaces a visible RECOVERY banner with one next step and re-arms the mic automatically. The conversation does not pause into a click-only state.
- **Save/resume:** the full shared state, voice settings, transcript, and the current beat autosave to localStorage. A fresh reload offers “Resume” by voice, restores the board and settings, and does not lose the run.
- **Slow/atypical speech:** the default silence window is generous, and **slow mode** switches to the buffered recogniser with a much longer local pause window so the model cannot cut a slow speaker off. “Slower” changes the host’s speaking rate independently.
- **Visuals:** the orbital foundry is drawn with Pixi/CSS — planets, a colony that gains a structure per tick, equity-sized crew quarters, and a rocket that launches when the summary is prepared. Large type, high contrast, large targets, a full caption history, and one clear next step are part of the shell.

## Demo beats

The page opens on the Orbital Foundry landing screen, listening. Say **Enter the bridge**.

1. **Home base:** compare the three fictional places (Mars, Europa, Andromeda Galaxy) and pick one by voice. A short rocket-travel cinematic covers the switch to the colony.
2. **Crew and equity:** choose 1–5 owners, set a split by voice or slider, then confirm the normalized split. The 100% invariant is enforced in `lib/equity.ts`; the walk does not advance until the visible split is confirmed.
3. **Build 5/5, one at a time:** the host asks “Structure 1 of 5: Landing pad. Say yes to raise it.” One explicit yes raises exactly one structure and gets a spoken confirmation before the next question. “Build all five” / “finish the build” does not bulk-complete; it re-asks the current structure.
4. **Approve the name:** at 5/5, the colony asks for the fictional company name. Say “Approve Galactic Bagels” or “Call it <your name>”; custom names are forced to carry “(fictional)”.
5. **Grounded s.85:** say “Explain section 85”. The card shows verbatim pack text and pack/fact grounding; the host reads one grounded sentence.
6. **Lawyer summary:** say “Prepare the lawyer summary”. The package carries the approved name, home base, split, 5/5 checklist, and s.85 grounding. Prep only — no email, no filing, no submission.

The optional Filing Intel archive (steps and fees) remains available by voice but is not a required mission.

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
