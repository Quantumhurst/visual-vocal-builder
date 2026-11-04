# Visual Vocal Builder

## Demo video

https://youtu.be/SMe399KwzjM

Build a fictional colony and incorporate a fictional company by voice, hands-free. Spoken words move an orbital foundry world: pick a home base, name the company, split equity, raise five structures, and prepare a lawyer summary. A founder who cannot use a mouse, keyboard, or pointer can finish the whole journey on a headset.

> **Demo data only. This is not legal advice, not a filing, and nothing here is submitted to any registry.**

## Run it locally

Requirements: use Node 22.18+ to run everything; the app itself also runs on Node 20.9+. You also need npm, Git, and a Meta Model API key.

```bash
git clone https://github.com/Quantumhurst/visual-vocal-builder.git
cd visual-vocal-builder
npm install
cp .env.example .env   # fill in META_API_KEY (never commit .env)
npm run build
NODE_ENV=production node server.mjs   # unified Next + ASR WebSocket server on :3000
```

Windows: use Git Bash, or replace cp with Copy-Item.

This repository includes no Meta API key — you must supply your own. Get one at [dev.meta.ai/platform](https://dev.meta.ai/platform), then put it in `.env` as `META_API_KEY`.

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

It synthesizes a user voice with macOS `say`, feeds the waveform into a virtual microphone, lets the app's own AudioWorklet and Meta transcript path drive every step, and verifies the board, host line, and no-click count at each beat. It also checks host *and* heard caption agreement on every turn, the single SAY cue per mission, a two-part slow-speech turn (the first final is held and merged), the async summary progress + spoken completion, the caption scroll lock and new-turn release, host-audio silence recovery, no-speech recovery, tool-timeout recovery, the short resume line, Commander at start/milestones only, and live Chrome voice downloads (company-named summary and transcript files with the in-file disclaimer, generic vs explicit download, safe close, and the nothing-to-download notice). Results land in `proof/headset-walk.json` (ignored by git) and screenshots in `.shots/`.

Tests import TypeScript sources directly and need Node 22.18+ for type stripping; the app itself runs on Node 20.9+.

## How it works

- **Voice in:** Muse Voice Transcribe streams partials for live painting and sends an authoritative final transcript. A buffered `/api/transcribe` fallback retries the same audio when a streamed turn goes empty or silent, so a turn is not dropped. The brain is Muse Spark via the Meta Model API; deterministic commands take a local fast lane through the same state appliers.
- **Voice out:** the curated system voice speaks every host line. Host speech is logged, replayable with “repeat that”, and never treated as user speech: the mic is gated during playback and a lexical echo filter tombstones self-echo. The mic reopens automatically after the host finishes.
- **Commander address:** the host says “Commander” at the journey start and at milestones only (home base, name, confirmed split, 5/5 build, summary ready). It is deliberately absent from split adjustments, individual structures 1–4, utility replies, and the lawyer-summary file, which stays formal.
- **Voice-only entry:** the landing page listens for “Enter the bridge” (or “Resume” / “Start over” when a run is saved). Crossing the bridge mounts the cockpit and starts the conversation without a click.
- **Always-available controls:** say **help**, **repeat that**, **stop**, **slower**, **faster**, **louder**, **quieter**, **volume 40**, **mute/unmute**, **show/hide transcript**, **save progress**, **start over**, **status**, **test voice**, **slow mode**, or **take your time**. All are parsed locally, before any model turn, in every state. “Stop” silences the host but keeps the mic listening for “continue”. The cockpit shows HOST AUDIO READY/SPEAKING/OFF/SILENT; if a voice never starts, it retries the system default once and then says so visibly rather than continuing in silence.
- **Five required beats, in order:** home base → company name → crew split (confirmed) → five structures → lawyer summary. The company name is approved immediately after the home base, before equity and the build. The filing-steps/fees card remains the one optional archive system.
- **Grounded facts only:** the optional filing-steps/fees content is verbatim pack text (`lib/knowledge.ts`), with pack id and fact ids on the card and a separate verifier checking it. Nothing legal is invented in prose.
- **Live captions are the primary channel:** the HOST line and the HEARD line are always visible, large and high-contrast, directly above the controls, and the full caption history stays open in the mission rail. The HOST caption is the exact capped line the speech engine receives — never an uncapped agent reply running alongside a shortened utterance. The transcript modal remains as an expanded view, not the only way to read the run. If the reader scrolls back, auto-follow pauses and a RESUME LIVE control appears; a new conversational turn or that tap resumes following.
- **Async summary, never a silent wait:** preparing the lawyer summary runs in short timer slices with a visible “BUILDING YOUR SUMMARY · %” caption. The host speaks a short start line and speaks the finished summary when it lands, even if the user is mid-turn (it waits for a free moment). The mic stays responsive throughout.
- **One clear next step:** every required mission shows exactly one SAY cue and at most one fallback chip. The host asks for the same single step; alternate phrasings remain understood by voice but are not presented as a menu.
- **Voice downloads and safe close:** after the summary lands, the host asks “Would you like the demo package — nothing was filed or sent?” Say **“yes”** to save it (or **“no”** to skip); one company-named `.txt` saves both the summary and transcript. The explicit “Download package” (or “download both”) command also saves the one-file package. “download” saves the lawyer summary when the transcript is closed and the transcript when its window is open, and “download summary” / “download transcript” work explicitly whenever that content exists. Files are named for the company (`galactic-bagels-summary.txt`, `galactic-bagels-transcript.txt`, `galactic-bagels-demo-package.txt`) and carry the demo / not-a-filing disclaimer inside. The host speaks a short confirmation on save, and says visibly when there is nothing to download. “Close” closes only the transcript window; there is no tab-close path.
- **Audio/visual agreement:** a local line is painted before it is spoken (two animation frames), and a new host line replaces the old utterance instead of queueing behind audio the caption no longer shows. Spoken lines are logged by the speech path itself, so the history never records the provisional fallback question an agent turn shows while thinking.
- **Turn-taking that survives slow speech:** the mic reopens after every host line. A recognizer final that is visibly unfinished ("The planet I want is …") is held, the mic stays open, and the next final is merged into one command; nothing half-formed is sent as a whole turn. The utterance cap is 55 seconds, and slow mode uses a longer local pause window.
- **Recovery, not stalls:** a dropped turn, silent host, lost live socket, stalled tool call, or a long silent LISTENING turn surfaces a visible RECOVERY banner with one next step and re-arms the mic automatically. Every agent tool has a 12-second timeout; the conversation does not pause into a click-only state.
- **Save/resume:** the full shared state, voice settings, transcript, and the current beat autosave to localStorage. A fresh reload offers “Resume” by voice, restores the board and settings, and speaks one short line with the home base, company name, split, and build count instead of replaying the transcript.
- **Slow/atypical speech:** the default silence window is generous, and **slow mode** switches to the buffered recogniser with a much longer local pause window so the model cannot cut a slow speaker off. “Slower” changes the host’s speaking rate independently.
- **Visuals:** the orbital foundry is drawn with Pixi/CSS — planets, a colony that gains a structure per tick, equity-sized crew quarters, and a rocket that launches when the summary is prepared. Large type, high contrast, large targets, a full caption history, and one clear next step are part of the shell.

## Demo beats

The page opens on the Orbital Foundry landing screen, listening. Say **Enter the bridge**.

1. **Home base:** compare the three fictional places (Mars, Europa, Andromeda Galaxy) and pick one by voice. A short rocket-travel cinematic covers the switch to the colony.
2. **Name the company:** immediately after the home base, say “Approve Galactic Bagels” or “Call it <your name>”. Custom names are forced to carry “(fictional)”. This approval feeds the lawyer summary.
3. **Crew and equity:** choose 1–5 owners, set a split by voice or slider, then confirm the normalized split. The 100% invariant is enforced in `lib/equity.ts`; the walk does not advance until the visible split is confirmed.
4. **Build 5/5, one at a time:** the host asks “Structure 1 of 5: Landing pad. Say yes to raise it.” One explicit yes raises exactly one structure and gets a spoken confirmation before the next question. “Build all five” / “finish the build” does not bulk-complete; it re-asks the current structure.
5. **Lawyer summary:** say “Prepare the lawyer summary”. The package carries the approved name, home base, split, and 5/5 checklist. Prep only — no email, no filing, no submission.

The optional Filing Intel archive (steps and fees) remains available by voice but is not a required mission.

## Follow-ups

- CopilotKit v2 migration.
- Shared rate-limit store (e.g. Upstash/Redis) instead of per-instance in-memory counts.

## Provenance & Hackathon Disclosure

### Meta Global AI Developer Hackathon
- **Problem Statement:** Build for Your World — Voice-driven spatial interface transforming complex corporate planning into a hands-free, visual, interactive canvas.
- **Track and team:** Indie track. Solo team: Steve Maley only.
- **Meta Models Incorporated:**
  - **Muse Voice Transcribe (`muse-voice-transcribe-1.0`)**: Realtime streaming speech-to-text with WebSocket chunk pacing, keyword biasing (fictional jurisdictions, founder names, legal concepts), and English language biasing via Meta Model API.
  - **Muse Spark (`muse-spark-1.3`)**: Cognitive agent brain driving multi-turn tool calling, invariant validation, and co-agent state synchronization via Meta Model API.

  The openai package is a client library only, pointed at api.meta.ai; no OpenAI model is called. Speech-out is the OS system voice, not an AI model call, and no other AI model, local or otherwise, is called at runtime.

- **Code & Planning Disclosure:**
  - Written planning only was developed prior to the event; zero code, datasets, or UI components were carried over.
  - All application code, styles, tests, and documentation in this repository were authored from scratch during the hackathon, October 27–November 4, 2026.
  - The Corp Plan pack texts in `lib/knowledge.ts` were written during the hackathon, October 27–November 4, 2026, not copied from Corp Plan.
  - Does not call or rely on any pre-existing private services.
  - Built with three assistant tools under direct developer guidance: Muse (Nuntuk), DeepSeek, and the Google coding agent.

## Credits

<img src="public/nuntuk-avatar.webp" alt="Nuntuk — a shrew wearing headphones, wraparound sunglasses, and a chunky gold chain" width="120" />

Built with Muse (Nuntuk), DeepSeek, and the Google coding agent, under Steve Maley's direction. The owner owns the repo and all rights to the work.

## License

MIT. See LICENSE.
