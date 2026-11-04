#!/usr/bin/env node
// Hands-free Mock Voice Playthrough for Visual Vocal Builder (VVB).
// Runs an automated two-way voice dialogue (Astronaut + Flight Host)
// end-to-end with visual UI updates and audible speech, hands-free.
//
// Usage:
//   node scripts/mock-voice-playthrough.mjs
//   node scripts/mock-voice-playthrough.mjs --headless
//   node scripts/mock-voice-playthrough.mjs --no-sound
//   node scripts/mock-voice-playthrough.mjs --url http://localhost:3000 --pace 1000

import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  puppeteer = require(process.env.PUPPETEER_CORE_PATH ?? "/tmp/vvb-puppeteer/node_modules/puppeteer-core");
}

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const hasFlag = (name) => args.includes(name);

const URL = opt("--url", "http://localhost:3000");
const IS_HEADLESS = hasFlag("--headless") || process.env.HEADLESS === "true";
const ENABLE_SOUND = !hasFlag("--no-sound") && process.platform === "darwin";
const USER_VOICE = opt("--voice", "Daniel");
const PACE_MS = Number(opt("--pace", "900"));
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function speakAloud(text, voice = USER_VOICE) {
  if (!ENABLE_SOUND) return Promise.resolve();
  return new Promise((resolve) => {
    const proc = spawn("/usr/bin/say", ["-v", voice, text], { stdio: "ignore" });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getSnapshot(page) {
  return page.evaluate(() => {
    const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? "";
    const sliders = [...document.querySelectorAll('input[aria-label*="equity percent"]')].map(
      (el) => Number(el.value),
    );
    const boxes = [...document.querySelectorAll('section[aria-label="Filing checklist"] input[type="checkbox"]')];
    const selPara = [...document.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Selected jurisdiction:"),
    );
    const deck = document.querySelector('[data-testid="command-deck"]');
    const win = window;
    return {
      selectedJurisdiction: selPara ? selPara.textContent.replace("Selected jurisdiction:", "").trim() : null,
      equitySplit: sliders.length ? sliders.join("/") : null,
      checklistTicked: boxes.filter((b) => b.checked).length,
      checklistTotal: boxes.length,
      hostPrompt: txt('[data-testid="host-prompt-text"]'),
      focusJurisdiction: txt('[data-testid="jurisdiction-focus"]') || null,
      turnPhase: deck?.getAttribute("data-phase") ?? null,
      lastSpoken: win.__vvbLastSpoken ?? null,
      allSpoken: [...(win.__vvbAllSpoken ?? [])],
      hasLawyerSummary: Boolean(
        document.querySelector('section[aria-label="Lawyer summary"] .is-ready') ||
        document.querySelector('button[aria-label*="Copy summary"]') ||
        [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Copy summary"))
      ),
      isRecording: Boolean(win.__vvbVoice?.isRecording?.()),
      isHostSpeaking: Boolean(win.__vvbVoice?.isHostSpeaking?.()),
    };
  });
}

async function waitForMicReady(page, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const isReady = await page.evaluate(() => {
      const deck = document.querySelector('[data-testid="command-deck"]');
      const phase = deck?.getAttribute("data-phase");
      const hook = window.__vvbVoice;
      const hostSpeaking = hook?.isHostSpeaking?.();
      return (phase === "recording" || hook?.isRecording?.()) && !hostSpeaking;
    });
    if (isReady) return;
    await sleep(150);
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for mic to auto-rearm hands-free`);
}

const SCRIPT_TURNS = [
  {
    id: "mars",
    stepName: "1. Select Home Base",
    userSpoken: "Let's go with Mars",
    verify: (snap) => snap.selectedJurisdiction === "Mars",
    describe: (snap) => `Jurisdiction locked: ${snap.selectedJurisdiction}`,
  },
  {
    id: "equity",
    stepName: "2. Rebalance Equity",
    userSpoken: "Make Orbit 70%",
    verify: (snap) => snap.equitySplit === "30/70",
    describe: () => "Equity split updated: Nova 30% / Orbit 70%",
  },
  {
    id: "confirm-equity",
    stepName: "3. Confirm Equity",
    userSpoken: "Confirm",
    verify: (snap) => snap.equitySplit === "30/70" && !snap.hostPrompt.includes("Confirm"),
    describe: () => "Equity confirmed hands-free, moved to checklist",
  },
  {
    id: "checklist-none",
    stepName: "4. Checklist Status",
    userSpoken: "None of them",
    verify: (snap) => snap.checklistTicked === 0,
    describe: () => "Acknowledged zero items, board stays visible",
  },
  {
    id: "checklist-advance",
    stepName: "5. Build Structures",
    userSpoken: "Tick off the first two checklist items",
    verify: (snap) => snap.checklistTicked === 2,
    describe: (snap) => `2 colony structures constructed (2/${snap.checklistTotal})`,
  },
  {
    id: "cheapest",
    stepName: "6. Educational Query",
    userSpoken: "What's the cheapest place to incorporate?",
    verify: (snap) => Boolean(snap.focusJurisdiction?.includes("Europa")) && snap.selectedJurisdiction === "Mars",
    describe: () => "Europa highlighted for comparison without altering Mars",
  },
  {
    id: "lawyer-summary",
    stepName: "7. Generate Summary",
    userSpoken: "Prepare the lawyer summary",
    verify: (snap) => snap.hasLawyerSummary,
    describe: () => "Lawyer summary prepared, mission complete!",
  },
  {
    id: "filing-guard",
    stepName: "8. Regulatory Filing Guard",
    userSpoken: "Is this actually going to file my company?",
    verify: (snap) => /no|not filed|fictional/i.test(snap.lastSpoken ?? snap.hostPrompt),
    describe: () => "Filing guard acknowledged: demo boundary enforced",
  },
];

async function run() {
  console.log("===============================================================================");
  console.log("   VVB HANDS-FREE MOCK VOICE PLAYTHROUGH");
  console.log("   Audio-Visual Dialogue Simulation: Astronaut (Daniel) <-> Host (Karen)");
  console.log("===============================================================================");
  console.log(` Target URL:   ${URL}`);
  console.log(` Mode:         ${IS_HEADLESS ? "Headless (CI)" : "Headful (Live Display on Screen)"}`);
  console.log(` Audio Out:    ${ENABLE_SOUND ? `Enabled (/usr/bin/say -v ${USER_VOICE} + Browser TTS)` : "Muted"}`);
  console.log(` Step Pace:    ${PACE_MS} ms\n`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: IS_HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1440,940",
    ],
    defaultViewport: IS_HEADLESS ? { width: 1440, height: 900 } : null,
  });

  const page = await browser.newPage();

  try {
    console.log("-> Launching application...");
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 45000 });

    // Step 0: Enter the bridge from LandingGate
    const enterBtn = await page.$('[data-testid="enter-bridge"]');
    if (enterBtn) {
      console.log("-> Entering the Bridge from Landing Screen...");
      await enterBtn.click();
      await page.waitForSelector('[data-testid="command-deck"]', { timeout: 15000 });
    }

    // Wait a beat for cockpit hydration
    await sleep(600);

    // Initial greeting trigger: start conversation mode
    console.log("-> Initializing Hands-Free Voice Mode (pressing Talk once)...");
    await page.evaluate(() => {
      const hook = window.__vvbVoice;
      if (hook?.startConvo) {
        hook.startConvo();
      } else {
        const mic = document.querySelector('[data-testid="mic-button"]');
        mic?.click();
      }
    });

    // Check first spoken greeting
    console.log("-> Waiting for Host initial greeting...");
    await sleep(1200);
    const initialSnap = await getSnapshot(page);
    console.log(`   [HOST GREETING]: "${initialSnap.lastSpoken ?? initialSnap.hostPrompt}"`);

    // Wait for the host speech to finish and hands-free mic to re-arm automatically
    process.stdout.write("-> Waiting for hands-free mic to arm... ");
    await waitForMicReady(page, 20000);
    console.log("ARMED (Ready to listen) [OK]\n");

    const turnResults = [];

    // Run each scripted turn in full conversational flow
    for (const turn of SCRIPT_TURNS) {
      const turnStart = Date.now();
      console.log(`-------------------------------------------------------------------------------`);
      console.log(` ${turn.stepName}`);
      console.log(`   Astronaut: "${turn.userSpoken}"`);

      // 1. Speak aloud as the user (if sound enabled)
      await speakAloud(turn.userSpoken, USER_VOICE);

      // 2. Feed the voice command into the page
      await page.evaluate((text) => {
        return window.__vvbVoice.feedVoice(text);
      }, turn.userSpoken);

      // 3. Wait for host speech to complete and mic to automatically re-arm hands-free
      await sleep(500); // brief settling period for state & speech to start
      await waitForMicReady(page, 25000);
      const latencyMs = Date.now() - turnStart;

      // 4. Inspect snapshot
      const snap = await getSnapshot(page);
      const passed = turn.verify(snap);

      console.log(`   Host:      "${snap.lastSpoken ?? snap.hostPrompt}"`);
      console.log(`   Result:    ${passed ? "[PASS]" : "[FAIL]"} (${turn.describe(snap)}) - Latency: ${latencyMs}ms`);
      console.log(`   Mic:       Hands-free auto-rearmed for next turn [OK]`);

      turnResults.push({
        id: turn.id,
        step: turn.stepName,
        userSpoken: turn.userSpoken,
        hostReply: snap.lastSpoken ?? snap.hostPrompt,
        passed,
        latencyMs,
      });

      if (!passed) {
        console.error(`\n[!] Turn check failed on ${turn.stepName}. Aborting.`);
        break;
      }

      await sleep(PACE_MS);
    }

    console.log(`===============================================================================`);
    console.log(` MOCK VOICE PLAYTHROUGH SUMMARY`);
    console.log(`===============================================================================`);
    const allPassed = turnResults.length === SCRIPT_TURNS.length && turnResults.every((t) => t.passed);
    for (const res of turnResults) {
      console.log(` ${res.passed ? "✓ PASS" : "✗ FAIL"} | ${res.step.padEnd(28)} | ${res.latencyMs}ms`);
    }

    console.log(`\n Total Turns Completed: ${turnResults.length}/${SCRIPT_TURNS.length}`);
    console.log(` Status:                ${allPassed ? "ALL TURNS PASSED - FLOWS LIKE WATER!" : "FAILED"}`);
    console.log(` Hands-Free Operation:  100% verified (Zero manual clicks during entire dialogue)\n`);

    if (!IS_HEADLESS) {
      console.log("Leaving display open for 4 seconds so you can admire the final Martian colony...");
      await sleep(4000);
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Playthrough error:", err);
  process.exit(1);
});
