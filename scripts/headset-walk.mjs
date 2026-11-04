#!/usr/bin/env node
// Headset walk — voice-in, no pointer.
//
// This is deliberately NOT the old mock harness: it feeds real audio
// waveforms through the microphone path (a virtual headset stream), so
// the app's own AudioWorklet, WebSocket ASR, and Meta transcripts drive
// every step. No command text is injected and no button is clicked.
//
//   node scripts/headset-walk.mjs
//   node scripts/headset-walk.mjs --headless
//   node scripts/headset-walk.mjs --url http://localhost:3000
//
// Speech in is synthesized with macOS `say` (a user voice), converted to
// 16 kHz mono WAV, and played into a virtual MediaStream. Speech out is
// the app's own system voice; every host line is logged by the app and
// checked here.

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const hasFlag = (name) => args.includes(name);

const URL = opt("--url", "http://localhost:3000");
const HEADLESS = hasFlag("--headless") || process.env.HEADLESS === "true";
const USER_VOICE = opt("--voice", "Daniel");
const PACE_MS = Number(opt("--pace", "450"));
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const SHOTS = path.resolve(".shots", `headset-${STAMP}`);
const AUDIO_DIR = path.resolve(".tmp-audio", "headset");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(AUDIO_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function synth(text, key) {
  const aiff = path.join(AUDIO_DIR, `${key}.aiff`);
  const wav = path.join(AUDIO_DIR, `${key}.wav`);
  execFileSync("/usr/bin/say", ["-v", USER_VOICE, "-o", aiff, text]);
  execFileSync("/opt/homebrew/bin/ffmpeg", [
    "-y", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav,
  ]);
  return readFileSync(wav).toString("base64");
}

function audioInitScript() {
  // Runs before any page script. Replaces the microphone with a virtual
  // headset destination and exposes one function to speak into it.
  const stateKey = "__vvbVirtualMic";
  let mic = null;
  function ensureMic() {
    if (!mic) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx({ sampleRate: 48000 });
      const dest = ctx.createMediaStreamDestination();
      mic = { ctx, dest };
      window[stateKey] = mic;
    }
    return mic;
  }
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    configurable: true,
    value: async () => {
      const { ctx, dest } = ensureMic();
      await ctx.resume();
      // A clone lets the app stop its own stream without killing the
      // virtual device the next screen uses.
      const track = dest.stream.getAudioTracks()[0].clone();
      return new MediaStream([track]);
    },
  });
  window.__vvbPlayAudio = async (base64) => {
    const { ctx, dest } = ensureMic();
    await ctx.resume();
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const audio = await ctx.decodeAudioData(bytes.buffer);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(dest);
    src.start();
    await new Promise((resolve) => {
      src.onended = resolve;
      setTimeout(resolve, Math.max(3000, (audio.duration + 3) * 1000));
    });
    await new Promise((r) => setTimeout(r, 250));
    return audio.duration;
  };
  window.__vvbClicks = 0;
  document.addEventListener("click", () => { window.__vvbClicks += 1; }, true);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const voice = window.__vvbVoice;
    const state = voice?.getState?.() ?? null;
    const mission = document.querySelector('[data-testid="next-step"]')?.textContent?.trim() ?? "";
    const prompt = document.querySelector('[data-testid="mission-prompt"]')?.textContent?.trim() ?? "";
    const host = document.querySelector('[data-testid="host-prompt-text"]')?.textContent?.trim() ?? "";
    const heard = document.querySelector('[data-testid="captions-heard"]')?.textContent?.trim() ?? "";
    const gate = document.querySelector('[data-testid="voice-gate-status"]')?.textContent?.trim() ?? "";
    const hostAudio = document.querySelector('[data-testid="host-audio"]')?.textContent?.trim() ?? "";
    const recoveryEl = document.querySelector('[data-testid="recovery-banner"]');
    const fontOf = (sel) => {
      const el = document.querySelector(sel);
      return el ? parseFloat(getComputedStyle(el).fontSize) || 0 : 0;
    };
    return {
      state,
      mission,
      prompt,
      host,
      heard,
      gate,
      hostAudio,
      lastSpoken: window.__vvbLastSpoken ?? "",
      allSpoken: [...(window.__vvbAllSpoken ?? [])],
      recording: Boolean(voice?.isRecording?.()),
      listening: Boolean(voice?.isListening?.()),
      audioStats: voice?.getAudioStats?.() ?? null,
      hostSpeaking: Boolean(voice?.isHostSpeaking?.()),
      phase: voice?.getPhase?.() ?? "no-cockpit",
      transcriptOpen: Boolean(document.querySelector('[data-testid="transcript-panel"]')),
      transcriptCount: document.querySelectorAll('[data-testid="transcript-list"] li').length,
      clicks: window.__vvbClicks ?? 0,
      recoveryKind: recoveryEl?.getAttribute("data-kind") ?? "",
      continuation: Boolean(document.querySelector('[data-testid="continuation-notice"]')),
      sayCount: document.querySelectorAll('[data-testid="next-step"]').length,
      chipCount: document.querySelectorAll('[data-testid="mission-chip"]').length,
      historyCount: document.querySelectorAll('[data-testid="caption-history"] li').length,
      historyVisible: Boolean(document.querySelector('[data-testid="caption-history-panel"]')),
      hostFont: fontOf('[data-testid="host-prompt-text"]'),
      heardFont: fontOf('[data-testid="captions-heard"]'),
      historyFont: fontOf('[data-testid="caption-history"] li p'),
      recovery: voice?.getRecovery?.() ?? null,
      caption: voice?.getCaption?.() ?? null,
      nextBeat: state ? (() => {
        const list = ["jurisdiction", "name", "equity", "checklist", "summary"];
        const done = {
          jurisdiction: Boolean(state.selectedJurisdiction),
          name: Boolean(state.companyName),
          equity: state.equityNote !== "",
          checklist: state.checklist.length > 0 && state.checklist.every((i) => i.done),
          summary: Boolean(state.lawyerPackage),
        };
        // The app's beatProgress is the authority; this is only a display
        // fallback for the proof report.
        return list.find((b) => !done[b]) ?? "complete";
      })() : null,
    };
  });
}

async function waitFor(label, fn, timeoutMs = 30000, intervalMs = 200) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function waitForOrNull(label, fn, timeoutMs = 8000) {
  try {
    return await waitFor(label, fn, timeoutMs);
  } catch {
    return null;
  }
}

// Punctuation and curly quotes vary between the DOM and the spoken line;
// the words must not.
function captionKey(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[“”"'’·]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function captionsMatch(snap) {
  const host = captionKey(snap.host);
  const spoken = captionKey(snap.lastSpoken);
  return Boolean(host && spoken) && host === spoken;
}

async function waitMicReady(page, timeout = 30000) {
  return waitFor("hands-free mic ready", async () => {
    const snap = await snapshot(page);
    return snap.recording && snap.listening && !snap.hostSpeaking && snap.phase === "recording"
      ? snap
      : null;
  }, timeout);
}

async function say(page, base64) {
  return page.evaluate((b64) => window.__vvbPlayAudio(b64), base64);
}

async function hostCount(page) {
  return page.evaluate(() => window.__vvbAllSpoken?.length ?? 0);
}

async function waitNewHost(page, before, test, label, timeout = 25000) {
  return waitFor(label, async () => {
    const count = await hostCount(page);
    if (count <= before) return null;
    const snap = await snapshot(page);
    return test(snap.lastSpoken || snap.host) ? snap : null;
  }, timeout);
}

async function screenshot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

const TURNS = [
  {
    id: "home-slow",
    text: "The planet I want is / Mars as our home base",
    label: "home base (slow two-part speech)",
    // The first final is visibly unfinished. The app must hold it, keep
    // the mic open, and merge the second part — never send half a thought.
    slow: [
      { id: "slow-a", text: "The planet I want is" },
      { id: "slow-b", text: "Mars as our home base" },
    ],
    expect: (s) => s.selectedJurisdiction === "Mars",
    // The new order asks for the company name immediately after the
    // home base, before equity.
    host: /Name the fictional company|Approve Galactic Bagels/i,
  },
  {
    id: "name",
    text: "Approve Galactic Bagels",
    label: "company name approval",
    expect: (s) => /Galactic Bagels/.test(s.companyName ?? ""),
    host: /approved as.*Make Orbit|company name approved/i,
  },
  {
    id: "owners",
    text: "Four owners",
    label: "owner count",
    expect: (s) => s.founders.length === 4,
    host: /owners|ownership/i,
  },
  {
    id: "equity",
    text: "Make Nova 40 percent",
    label: "equity split",
    expect: (s) => s.founders[0]?.percent === 40,
    host: /ownership|percent|owners/i,
  },
  {
    id: "confirm",
    text: "Yes, confirm the split",
    label: "split confirmation",
    expect: () => true,
    host: /confirmed.*Structure 1 of 5|Landing pad/i,
  },
  ...[1, 2, 3, 4, 5].map((n) => ({
    id: `build-${n}`,
    text: "Yes",
    label: `structure ${n} of 5`,
    expect: (s) => s.checklist.filter((i) => i.done).length === n,
    host: n < 5
      ? /raised|structures? up|Next:|tell me more/i
      : /Everything is lined up|Prepare the lawyer summary/i,
  })),
  {
    id: "summary",
    text: "Prepare the lawyer summary",
    label: "lawyer summary",
    expect: (s) => (s.lawyerPackage ?? "").length > 0,
    host: /Summary prepared|Mission complete/i,
  },
];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1440,940",
      `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "vvb-headset-"))}`,
    ],
    defaultViewport: { width: 1440, height: 940 },
  });
  const page = await browser.newPage();
  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`pageerror: ${err.message}`));
  await page.evaluateOnNewDocument(audioInitScript);

  const results = [];
  let current = 0;
  try {
    console.log(`\nHEADLESS ${HEADLESS ? "yes" : "no"} · ${URL}`);
    console.log("Generating headset audio…");
    const audio = {};
    for (const item of [
      ["entry", "Enter the bridge"],
      ...TURNS.flatMap((turn) =>
        turn.slow
          ? turn.slow.map((part) => [part.id, part.text])
          : [[turn.id, turn.text]],
      ),
      ["resume", "Resume"],
      ["help", "Help"],
      ["slower", "Slower"],
      ["repeat", "Repeat that"],
      ["stop", "Stop"],
      ["continue", "Continue"],
      ["transcript", "Show transcript"],
      ["hide-transcript", "Hide transcript"],
      ["save", "Save progress"],
      ["test-voice", "Test voice"],
      ["start-over", "Start over"],
    ]) {
      audio[item[0]] = synth(item[1], item[0]);
    }

    console.log("Opening a fresh page…");
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
    await waitFor("voice gate", async () => {
      const snap = await snapshot(page);
      return /Listening for your voice/i.test(snap.gate);
    }, 20000);
    await screenshot(page, "00-voice-gate");
    console.log("Landing is listening. Saying: Enter the bridge");
    await say(page, audio.entry);
    await waitFor("cockpit after voice entry", async () => {
      return page.evaluate(() => Boolean(document.querySelector('[data-testid="command-deck"]')));
    }, 30000);
    await waitFor("cockpit mic ready", () => waitMicReady(page, 30000));
    console.log("Entered by voice. No click.");

    let snap = await snapshot(page);
    console.log(`  Gate → cockpit. Host: "${snap.lastSpoken || snap.host}"`);
    const captionLayout = {
      hostLarge: snap.hostFont >= 17,
      heardLarge: snap.heardFont >= 17,
      historyAlwaysVisible: snap.historyVisible && snap.historyCount >= 1,
      historyReadable: snap.historyFont >= 11.5,
      oneSay: snap.sayCount === 1,
      oneChip: snap.chipCount === 1,
      hostAgrees: captionsMatch(snap),
    };
    console.log(
      "  Captions:",
      `host ${snap.hostFont}px · heard ${snap.heardFont}px · history ${snap.historyFont}px · ` +
      `SAY ${snap.sayCount} · chip ${snap.chipCount} · agree ${captionLayout.hostAgrees}`,
    );
    if (!Object.values(captionLayout).every(Boolean)) {
      throw new Error(`Caption layout failed: ${JSON.stringify(captionLayout)}`);
    }
    results.push({
      step: "enter",
      heard: "Enter the bridge",
      host: snap.lastSpoken || snap.host,
      passed: true,
      captions: captionLayout,
      clicks: snap.clicks,
    });
    await screenshot(page, "01-cockpit");

    const captionFailures = [];
    for (const turn of TURNS) {
      current += 1;
      await waitMicReady(page, 40000);
      await sleep(320);
      console.log(`\n[${current}/${TURNS.length}] ${turn.label} — saying: "${turn.text}"`);
      let holdSeen = false;
      if (turn.slow) {
        // Speak the first half, give the recognizer time to finish a turn,
        // then speak the second half. A glasses loop must hold the
        // unfinished final and keep the mic open.
        await say(page, audio[turn.slow[0].id]);
        const held = await waitForOrNull("held unfinished thought", async () => {
          const s = await snapshot(page);
          return s.continuation ? s : null;
        }, 8000);
        if (held) {
          holdSeen = true;
          console.log("  Held the unfinished thought; waiting for the mic to reopen.");
          await waitMicReady(page, 30000);
        } else {
          console.log("  No hold observed (the recognizer kept the turn open); continuing.");
          await sleep(700);
        }
        await say(page, audio[turn.slow[1].id]);
      } else {
        await say(page, audio[turn.id]);
      }
      const state = await waitFor(turn.label, async () => {
        const s = await snapshot(page);
        // The confirm row checks the visible prompt; every other row
        // checks the actual shared state.
        if (turn.id === "confirm") {
          return /Structure 1 of 5/i.test(s.prompt) ? s : null;
        }
        return turn.expect(s.state) ? s : null;
      }, 40000);
      await waitFor(`${turn.label} host line`, async () => {
        const s = await snapshot(page);
        return turn.host.test(s.lastSpoken || s.host) ? s : null;
      }, 30000);
      await waitFor(`${turn.label} mic re-arm`, () => waitMicReady(page, 45000));
      snap = await snapshot(page);
      const visible = snap.prompt;
      const agrees = captionsMatch(snap);
      const oneSay = snap.sayCount === 1;
      const oneChip = snap.chipCount <= 1;
      const historyVisible = snap.historyVisible && snap.historyCount >= 2;
      const noRecovery = snap.recoveryKind === "";
      const lastUser = await page.evaluate(() => {
        const log = window.__vvbVoice?.getLog?.() ?? [];
        const you = log.filter((entry) => entry.role === "you");
        return you[you.length - 1]?.text ?? "";
      });
      // The big HEARD caption must be the latest captured turn, not the
      // previous command while the history log has moved on.
      const heardAgrees = captionKey(snap.heard) === captionKey(lastUser);
      const slowMerged = turn.slow
        ? /want/i.test(lastUser) && /mars/i.test(lastUser)
        : null;
      const passed =
        Boolean(state) &&
        Boolean(snap.recording) &&
        agrees &&
        heardAgrees &&
        oneSay &&
        oneChip &&
        historyVisible &&
        noRecovery &&
        (slowMerged === null || slowMerged === true);
      console.log(`  Host: "${snap.lastSpoken}"`);
      console.log(`  Heard: "${snap.heard}"`);
      console.log(`  Screen: ${snap.mission} · ${visible.slice(0, 110)}`);
      console.log(
        `  Captions agree: ${agrees} · heard ${heardAgrees} · SAY ${snap.sayCount} · chips ${snap.chipCount} · history ${snap.historyCount}` +
        (turn.slow ? ` · held ${holdSeen} · merged ${slowMerged}` : ""),
      );
      console.log(`  ${passed ? "PASS" : "FAIL"} · mic re-armed · clicks so far ${snap.clicks}`);
      if (!agrees || !heardAgrees) {
        captionFailures.push({
          step: turn.id,
          kind: !agrees ? "host" : "heard",
          host: snap.host,
          spoken: snap.lastSpoken,
          heard: snap.heard,
          lastUser,
        });
      }
      results.push({
        step: turn.id,
        heard: turn.text,
        host: snap.lastSpoken,
        heardCaption: snap.heard,
        lastUser,
        screen: visible,
        nextStep: snap.mission,
        passed,
        captionsAgree: agrees,
        heardAgrees,
        oneSay,
        oneChip,
        historyCount: snap.historyCount,
        holdSeen,
        slowMerged,
        clicks: snap.clicks,
        screenshot: await screenshot(page, `${String(current).padStart(2, "0")}-${turn.id}`),
      });
      if (!passed) throw new Error(`Step failed: ${turn.label}`);
      await sleep(PACE_MS);
    }

    // Final state and disclaimer checks.
    const final = await snapshot(page);
    const s = final.state;
    const checks = {
      enteredByVoice: true,
      homeBase: s.selectedJurisdiction === "Mars",
      fourOwners: s.founders.length === 4,
      split: s.founders.reduce((sum, f) => sum + f.percent, 0) === 100,
      structures: s.checklist.filter((i) => i.done).length === 5,
      nameApproved: /Galactic Bagels/.test(s.companyName ?? ""),
      nameBeforeEquity:
        results.findIndex((row) => row.step === "name") >= 0 &&
        results.findIndex((row) => row.step === "name") <
          results.findIndex((row) => row.step === "equity"),
      noRollover: s.rolloverCard === null,
      summary: (s.lawyerPackage ?? "").length > 0,
      noClicks: final.clicks === 0,
      wasListening: final.allSpoken.length > 0,
      noFilingClaim: !/filed successfully|submitted to the registry/i.test(s.lawyerPackage ?? ""),
      captionsAgreeEveryTurn: captionFailures.filter((row) => row.kind === "host").length === 0,
      heardCaptionsAgreeEveryTurn: captionFailures.filter((row) => row.kind === "heard").length === 0,
      oneSayEveryTurn: results.every((row) => row.oneSay !== false),
      oneChipEveryTurn: results.every((row) => row.oneChip !== false),
      captionHistoryGrew: final.historyCount >= 20,
      slowSpeechMerged: results.find((row) => row.step === "home-slow")?.slowMerged === true,
    };
    console.log("\nFINAL CHECKS");
    for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    await screenshot(page, "09-summary");
    await page.evaluate(() => window.scrollTo(0, 0));

    // Voice-only transcript + save + meta controls.
    await waitMicReady(page, 40000);
    console.log('\n[meta] Show transcript');
    await say(page, audio.transcript);
    await waitFor("transcript open by voice", async () => (await snapshot(page)).transcriptOpen, 20000);
    const transcript = await snapshot(page);
    console.log(`  Transcript open with ${transcript.transcriptCount} entries.`);
    await screenshot(page, "10-transcript");
    await waitMicReady(page, 30000);
    await say(page, audio["hide-transcript"]);
    await waitFor("transcript closed by voice", async () => !(await snapshot(page)).transcriptOpen, 20000);

    await waitMicReady(page, 30000);
    let hostBefore = await hostCount(page);
    await say(page, audio.help);
    const help = await waitNewHost(page, hostBefore, (text) => /Mission complete|Say|help|transcript/i.test(text), "help answered");
    hostBefore = await hostCount(page);
    console.log(`  Help: "${help.lastSpoken}"`);

    await waitMicReady(page, 30000);
    hostBefore = await hostCount(page);
    await say(page, audio.slower);
    await waitNewHost(page, hostBefore, (text) => /Slower|speak at/i.test(text), "slower answered");
    await waitFor("slower applied", async () => {
      const data = await page.evaluate(() => window.__vvbVoice.getSettings());
      return data.rate < 1;
    }, 20000);
    console.log("  Slower applied by voice.");

    await waitMicReady(page, 30000);
    hostBefore = await hostCount(page);
    await say(page, audio.repeat);
    await waitNewHost(page, hostBefore, (text) => /Slower|speak at/i.test(text), "repeat answered");
    console.log("  Repeat answered by voice.");

    await waitMicReady(page, 30000);
    await sleep(300);
    await say(page, audio.stop);
    await waitFor("stop acknowledged", async () => {
      const snap = await snapshot(page);
      const host = await page.evaluate(() => document.querySelector('[data-testid="host-prompt-text"]')?.textContent ?? "");
      return /Stopped/i.test(host) && snap.recording && snap.listening;
    }, 25000);
    console.log("  Stop honored; mic still listening for continue.");

    await waitMicReady(page, 30000);
    hostBefore = await hostCount(page);
    await say(page, audio.continue);
    await waitNewHost(page, hostBefore, (text) => /Mission complete|Show transcript|lawyer summary/i.test(text), "continue answered");
    console.log("  Continue answered.");

    await waitMicReady(page, 30000);
    hostBefore = await hostCount(page);
    await say(page, audio.save);
    await waitNewHost(page, hostBefore, (text) => /Saved|save/i.test(text), "save acknowledged");
    console.log("  Save acknowledged.");

    // --- Recovery, not stalls ------------------------------------------
    // Real fault injection: make the system voice accept an utterance but
    // never start it. The app must surface HOST AUDIO SILENT, keep the
    // line on screen, and re-arm the mic without a click.
    console.log("\n[recovery] Host audio silence");
    await waitMicReady(page, 30000);
    await page.evaluate(() => {
      const synth = window.speechSynthesis;
      window.__vvbPrimalSpeak = synth.speak;
      Object.defineProperty(synth, "speak", { configurable: true, value: () => {} });
    });
    await say(page, audio.help);
    const silentRecovery = await waitFor("host silent recovery banner", async () => {
      const snap = await snapshot(page);
      return snap.recoveryKind === "host-silent" ? snap : null;
    }, 25000);
    await screenshot(page, "13-host-silent");
    const silentRearmed = await waitFor("mic re-armed after silent host", () => waitMicReady(page, 30000));
    await page.evaluate(() => {
      delete window.speechSynthesis.speak;
    });
    console.log(`  Visible: "${silentRecovery.recovery?.headline ?? "host audio silent"}" · mic re-armed.`);

    await waitMicReady(page, 30000);
    hostBefore = await hostCount(page);
    await say(page, audio["test-voice"]);
    await waitNewHost(page, hostBefore, (text) => /host voice/i.test(text), "test voice");
    const recoveredAudio = await waitFor("host audio recovered", async () => {
      const snap = await snapshot(page);
      return snap.hostAudio === "HOST AUDIO READY" && !snap.recoveryKind ? snap : null;
    }, 20000);
    console.log("  Host audio recovered; recovery banner cleared.");

    // A silent mic must not look like a healthy LISTENING state forever:
    // the no-speech timeout must surface and re-arm hands-free.
    console.log("\n[recovery] No speech");
    await waitMicReady(page, 30000);
    const silenceStart = Date.now();
    const noSpeechRecovery = await waitFor("no-speech recovery banner", async () => {
      const snap = await snapshot(page);
      return snap.recoveryKind === "no-speech" ? snap : null;
    }, 22000);
    console.log(`  Visible after ${Math.round((Date.now() - silenceStart) / 1000)}s; re-arming.`);
    await screenshot(page, "14-no-speech");
    const noSpeechRearmed = await waitFor("mic re-armed after no speech", () => waitMicReady(page, 30000));
    const recoveryChecks = {
      hostSilentVisible: silentRecovery.recoveryKind === "host-silent",
      hostSilentLineKept: Boolean(silentRecovery.host) && captionsMatch(silentRecovery),
      hostSilentRearmed: Boolean(silentRearmed.recording && silentRearmed.listening),
      hostAudioRecovered: recoveredAudio.hostAudio === "HOST AUDIO READY",
      noSpeechVisible: noSpeechRecovery.recoveryKind === "no-speech",
      noSpeechRearmed: Boolean(noSpeechRearmed.recording && noSpeechRearmed.listening),
    };
    console.log("\nRECOVERY CHECKS");
    for (const [name, ok] of Object.entries(recoveryChecks)) console.log(`  ${ok ? "✓" : "✗"} ${name}`);

    // Fresh reload: the saved run is offered, and "Resume" restores it.
    console.log("\nFresh reload → Resume by voice");
    await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
    await waitFor("saved gate", async () => {
      const snap = await snapshot(page);
      return /Saved run|Resume/i.test(snap.gate) || (await page.evaluate(() => Boolean(document.querySelector('[data-testid="voice-gate-saved"]'))));
    }, 30000);
    await waitFor("landing mic after reload", async () => {
      return page.evaluate(() => /Listening for your voice/i.test(
        document.querySelector('[data-testid="voice-gate-status"]')?.textContent ?? "",
      ));
    }, 30000);
    await screenshot(page, "11-resume-gate");
    await say(page, audio.resume);
    await waitFor("resumed cockpit", async () => {
      return page.evaluate(() => Boolean(document.querySelector('[data-testid="command-deck"]')));
    }, 30000);
    const resumed = await waitFor("resumed state", async () => {
      const s = await snapshot(page);
      return s.state?.lawyerPackage ? s : null;
    }, 30000);
    console.log(`  Resumed with summary intact. Host: "${resumed.lastSpoken || resumed.host}"`);
    await screenshot(page, "12-resumed");

    // Start over by voice, fresh walk reset.
    await waitMicReady(page, 40000);
    await say(page, audio["start-over"]);
    await waitFor("start over by voice", async () => {
      const s = await snapshot(page);
      return s.state && !s.state.selectedJurisdiction && !s.state.companyName;
    }, 30000);
    console.log("  Start over honored by voice.");
    const reset = await snapshot(page);
    results.push({
      step: "resume-and-reset",
      resumed: Boolean(resumed.state?.lawyerPackage),
      reset: !reset.state.selectedJurisdiction && !reset.state.companyName,
      clicks: reset.clicks,
    });

    const report = {
      at: new Date().toISOString(),
      url: URL,
      headless: HEADLESS,
      userVoice: USER_VOICE,
      clicks: final.clicks,
      checks,
      recoveryChecks,
      results,
      console: consoleLines.slice(-40),
    };
    writeFileSync(path.resolve("proof", "headset-walk.json"), JSON.stringify(report, null, 2));
    if (!Object.values(checks).every(Boolean)) {
      throw new Error(`Final checks failed: ${JSON.stringify(checks)}`);
    }
    if (!Object.values(recoveryChecks).every(Boolean)) {
      throw new Error(`Recovery checks failed: ${JSON.stringify(recoveryChecks)}`);
    }
    console.log(`\nWALK PASSED · ${results.length} voice turns · ${final.clicks} clicks · shots in ${SHOTS}\n`);
  } catch (err) {
    const failShot = path.join(SHOTS, "FAIL.png");
    try { await page.screenshot({ path: failShot, scale: "css" }); } catch { /* ignore */ }
    writeFileSync(path.resolve("proof", "headset-walk.json"), JSON.stringify({
      at: new Date().toISOString(),
      url: URL,
      error: err instanceof Error ? err.message : String(err),
      results,
      events: await page.evaluate(() => window.__vvbVoice?.getEvents?.() ?? []).catch(() => []),
      audioStats: await page.evaluate(() => window.__vvbVoice?.getAudioStats?.() ?? null).catch(() => null),
      asrState: await page.evaluate(() => window.__vvbVoice?.getAsrState?.() ?? null).catch(() => null),
      snapshot: await snapshot(page).catch(() => null),
      console: consoleLines.slice(-60),
      screenshot: failShot,
    }, null, 2));
    console.error(`\nWALK FAILED: ${err.message}`);
    console.error(`Screenshot: ${failShot}`);
    console.error(consoleLines.slice(-20).join("\n"));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
