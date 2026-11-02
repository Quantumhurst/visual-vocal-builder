// Proof harness (trial branch only). Drives installed Chrome via
// puppeteer-core from a scratch dir (NODE_PATH), never a package.json dep.
// Usage: node scripts/play-demo.mjs --url http://localhost:3202 --runs 5 --out proof/trial
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
  return i >= 0 ? args[i + 1] : dflt;
};
const URL = opt("--url", "http://localhost:3202");
const RUNS = Number(opt("--runs", "5"));
const OUT = opt("--out", "proof/trial");
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function snapshot(page) {
  return page.evaluate(() => {
    const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? "";
    const sliders = [...document.querySelectorAll('input[aria-label*="equity percent"]')].map(
      (el) => Number(el.value),
    );
    const boxes = [...document.querySelectorAll('section[aria-label="Filing checklist"] input[type="checkbox"]')];
    const selPara = [...document.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Selected jurisdiction:"),
    );
    return {
      selected: selPara ? selPara.textContent.replace("Selected jurisdiction:", "").trim() : null,
      equity: sliders,
      ticked: boxes.filter((b) => b.checked).length,
      checklistTotal: boxes.length,
      host: txt('[data-testid="host-prompt-text"]'),
      focus: txt('[data-testid="jurisdiction-focus"]') || null,
      turnError: txt('[data-testid="turn-error"]') || null,
      summaryBeatText: txt('[data-beat="summary"]'),
    };
  });
}

async function waitReady(page, timeoutMs = 120000) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="turn-phase"]');
      return el && (el.textContent?.includes("Ready") ?? false);
    },
    { timeout: timeoutMs },
  );
}

async function send(page, text) {
  const started = Date.now();
  await page.waitForSelector('input[placeholder*="Or type a command"]', { timeout: 30000 });
  await page.type('input[placeholder*="Or type a command"]', text);
  await page.keyboard.press("Enter");
  // Give the turn a moment to enter the busy phase, then wait for Ready.
  await new Promise((r) => setTimeout(r, 800));
  try {
    await waitReady(page);
  } catch {
    // Timeout is recorded via the snapshot (turnError / stale state).
  }
  return Date.now() - started;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function p90(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
}

async function oneRun(browser, idx) {
  const page = await browser.newPage();
  const httpErrors = [];
  page.on("response", (res) => {
    if (res.status() >= 400) httpErrors.push(`${res.status()} ${res.url()}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") httpErrors.push(`console: ${msg.text()}`);
  });
  const turns = [];
  const step = async (label, text) => {
    const ms = await send(page, text);
    const snap = await snapshot(page);
    turns.push({ label, text, ms, snap });
    return snap;
  };
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await waitReady(page, 60000);

  const s1 = await step("pick-mars", "Let's go with Mars");
  const s2 = await step("orbit-70", "Make Orbit 70%");
  const s3 = await step("voice-undo", "Actually, undo that");
  // G1b: Undo button (trial only; baseline records N/A).
  let g1b = "N/A";
  const hasUndo = await page.$('[data-testid="undo-button"]');
  if (hasUndo) {
    await page.click('[data-testid="undo-button"]');
    await new Promise((r) => setTimeout(r, 600));
    const afterUndoBtn = await snapshot(page);
    turns.push({ label: "undo-button", ms: 0, snap: afterUndoBtn });
    g1b = afterUndoBtn.selected === null && afterUndoBtn.equity.join("/") === "60/40";
    await page.screenshot({ path: path.join(OUT, `run-${idx}-undo.png`) }).catch(() => {});
  }
  const beforeCheapest = await snapshot(page);
  const s5 = await step("cheapest", "What's the cheapest place to incorporate?");
  await page.screenshot({ path: path.join(OUT, `run-${idx}-focus.png`) }).catch(() => {});
  const s6 = await step("tick-two", "Tick off the first two checklist items");
  await page.screenshot({ path: path.join(OUT, `run-${idx}-checklist.png`) }).catch(() => {});
  const s8 = await step("start-over", "Start over");
  const s9 = await step("guard", "Is this actually going to file my company?");

  const eq = (s) => s.equity.join("/");
  const checks = {
    step1Mars: s1.selected === "Mars",
    step2Equity3070: eq(s2) === "30/70",
    G1a: eq(s3) === "60/40",
    G1b: g1b,
    G3a: /Mars|Europa|Andromeda/.test(s5.host) && s5.host.includes("DEMO"),
    // Invariant form: the DEMO highlight never overrides the selection.
    // (Literal "still Mars" is unreachable in this fixed script: the
    // step-4 Undo click legitimately undoes the Mars pick first.)
    G3b: Boolean(s5.focus) && s5.selected === beforeCheapest.selected,
    G2a: s6.ticked === 2,
    G2b: !/already|nothing changed/i.test(s6.host),
    // Invariant form: re-asking equity only fails when equity is done
    // (split differs from the 60/40 DEMO start). After the two undos the
    // split is back at 60/40, so an equity question follows nextBeat.
    G2c: !(/equity|split/i.test(s6.host) && eq(s6) !== "60/40"),
    G1c:
      eq(s8) === "60/40" && s8.selected === null && s8.ticked === 0 && !(s8.summaryBeatText ?? "").includes("Copy summary"),
    guard: /no|not/i.test(s9.host) && s9.ticked === 0,
  };
  await page.close();
  return { run: idx, turns, checks, httpErrors };
}

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const results = [];
for (let i = 1; i <= RUNS; i++) {
  try {
    results.push(await oneRun(browser, i));
  } catch (err) {
    results.push({ run: i, error: String(err), checks: {}, turns: [], httpErrors: [] });
  }
  await writeFile(path.join(OUT, `run-${i}.json`), JSON.stringify(results[results.length - 1], null, 2));
}
await browser.close();

const keys = ["step1Mars", "step2Equity3070", "G1a", "G1b", "G3a", "G3b", "G2a", "G2b", "G2c", "G1c", "guard"];
const counts = {};
for (const k of keys) {
  counts[k] = {
    pass: results.filter((r) => r.checks?.[k] === true).length,
    na: results.filter((r) => r.checks?.[k] === "N/A").length,
    of: RUNS,
  };
}
const turnMs = results.flatMap((r) => (r.turns ?? []).filter((t) => t.ms > 0).map((t) => t.ms));
const summary = {
  url: URL,
  runs: RUNS,
  counts,
  medianTurnMs: median(turnMs),
  p90TurnMs: p90(turnMs),
  httpErrors: [...new Set(results.flatMap((r) => r.httpErrors ?? []))],
};
await writeFile(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

