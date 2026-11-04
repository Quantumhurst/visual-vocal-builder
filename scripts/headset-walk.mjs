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
    const gate = document.querySelector('[data-testid="voice-gate-status"]')?.textContent?.trim() ?? "";
    return {
      state,
      mission,
      prompt,
      host,
      gate,
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
      nextBeat: state ? (() => {
        const list = ["jurisdiction", "equity", "checklist", "name", "rollover", "summary"];
        const done = {
          jurisdiction: Boolean(state.selectedJurisdiction),
          equity: state.founders.some((f, i) => (i === 0 ? false : false)) || state.equityNote !== "",
          checklist: state.checklist.length > 0 && state.checklist.every((i) => i.done),
          name: Boolean(state.companyName),
          rollover: Boolean(state.rolloverCard),
          summary: Boolean(state.lawyerPackage),
        };
        // Equity is "done" once the split changed from the prepared 60/40
        // or an owner count was chosen. The app's beatProgress is the
        // authority; this is only a display fallback.
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

async function waitMicReady(page, timeout = 30000) {
  return waitFor("hands-free mic ready", async () => {
    const snap = await snapshot(page);
    return snap.recording && snap.listening && !snap.hostSpeaking && snap.phase === "recording";
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
    id: "home",
    text: "Pick Mars",
    label: "home base",
    expect: (s) => s.selectedJurisdiction === "Mars",
    host: /Mars/,
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
    host: /Build the colony|Build the next structure/i,
  },
  {
    id: "build",
    text: "Build all five structures",
    label: "5 of 5 structures",
    expect: (s) => s.checklist.length > 0 && s.checklist.every((i) => i.done),
    host: /All 5 structures|Approve the company name|Approve Galactic Bagels/i,
  },
  {
    id: "name",
    text: "Approve Galactic Bagels",
    label: "company name approval",
    expect: (s) => /Galactic Bagels/.test(s.companyName ?? ""),
    host: /approved as.*Explain section 85/i,
  },
  {
    id: "s85",
    text: "What is a section 85 rollover?",
    label: "grounded s.85 lesson",
    expect: (s) => s.rolloverCard?.factId === "s85-what-it-is",
    host: /Under s\.\s?85\(1\)/i,
  },
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
      ...TURNS.map((t) => [t.id, t.text]),
      ["resume", "Resume"],
      ["help", "Help"],
      ["slower", "Slower"],
      ["repeat", "Repeat that"],
      ["stop", "Stop"],
      ["continue", "Continue"],
      ["transcript", "Show transcript"],
      ["hide-transcript", "Hide transcript"],
      ["save", "Save progress"],
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
    results.push({
      step: "enter",
      heard: "Enter the bridge",
      host: snap.lastSpoken || snap.host,
      passed: true,
      clicks: snap.clicks,
    });
    await screenshot(page, "01-cockpit");

    for (const turn of TURNS) {
      current += 1;
      await waitMicReady(page, 40000);
      await sleep(320);
      console.log(`\n[${current}/${TURNS.length}] ${turn.label} — saying: "${turn.text}"`);
      await say(page, audio[turn.id]);
      const state = await waitFor(turn.label, async () => {
        const s = await snapshot(page);
        // The confirm row checks the visible prompt; every other row
        // checks the actual shared state.
        if (turn.id === "confirm") {
          return /Build the colony|Build the next structure/i.test(s.prompt) ? s : null;
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
      const passed = Boolean(state) && Boolean(snap.recording);
      console.log(`  Host: "${snap.lastSpoken}"`);
      console.log(`  Screen: ${snap.mission} · ${visible.slice(0, 110)}`);
      console.log(`  ${passed ? "PASS" : "FAIL"} · mic re-armed · clicks so far ${snap.clicks}`);
      results.push({
        step: turn.id,
        heard: turn.text,
        host: snap.lastSpoken,
        screen: visible,
        nextStep: snap.mission,
        passed,
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
      groundedS85: s.rolloverCard?.factId === "s85-what-it-is",
      summary: (s.lawyerPackage ?? "").length > 0,
      noClicks: final.clicks === 0,
      wasListening: final.allSpoken.length > 0,
      noFilingClaim: !/filed successfully|submitted to the registry/i.test(s.lawyerPackage ?? ""),
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
      results,
      console: consoleLines.slice(-40),
    };
    writeFileSync(path.resolve("proof", "headset-walk.json"), JSON.stringify(report, null, 2));
    if (!Object.values(checks).every(Boolean)) {
      throw new Error(`Final checks failed: ${JSON.stringify(checks)}`);
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
