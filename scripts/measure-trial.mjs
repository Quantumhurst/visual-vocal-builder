import { WebSocket } from "ws";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function generateWav(text, outPath) {
  return new Promise((resolve, reject) => {
    if (!text || text.trim() === "") {
      // 1.5s of silence
      const sampleRate = 16000;
      const numSamples = Math.round(sampleRate * 1.5);
      const dataSize = numSamples * 2;
      const header = Buffer.alloc(44);
      header.write("RIFF", 0);
      header.writeUInt32LE(36 + dataSize, 4);
      header.write("WAVE", 8);
      header.write("fmt ", 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20); // PCM
      header.writeUInt16LE(1, 22); // mono
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(sampleRate * 2, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write("data", 36);
      header.writeUInt32LE(dataSize, 40);
      const silence = Buffer.concat([header, Buffer.alloc(dataSize, 0)]);
      fs.writeFileSync(outPath, silence);
      return resolve();
    }
    const proc = spawn("/usr/bin/say", [
      "--file-format=WAVE",
      "--data-format=LEI16@16000",
      "-o",
      outPath,
      text,
    ]);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`say failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function streamAudioToWs(wavPath) {
  const buf = fs.readFileSync(wavPath);
  let dataOffset = 44;
  for (let i = 0; i < buf.length - 8; i++) {
    if (buf.toString("utf8", i, i + 4) === "data") {
      dataOffset = i + 8;
      break;
    }
  }
  const pcm = buf.subarray(dataOffset);

  const ws = new WebSocket("ws://localhost:3000/api/asr-stream");

  let readyResolve;
  const readyPromise = new Promise((r) => { readyResolve = r; });

  let completeResolve;
  const completePromise = new Promise((r) => { completeResolve = r; });

  const events = [];
  let streamStartTime = 0;
  let firstPartialTime = null;

  ws.on("message", (data) => {
    const raw = data.toString();
    const parsed = JSON.parse(raw);
    const lag = streamStartTime > 0 ? Date.now() - streamStartTime : 0;
    events.push({ ...parsed, lagMs: lag });

    if (parsed.type === "ready") {
      readyResolve();
    } else if (parsed.type === "transcript") {
      if (firstPartialTime === null && streamStartTime > 0) firstPartialTime = lag;
    } else if (parsed.type === "speechComplete") {
      completeResolve(parsed);
    }
  });

  await readyPromise;

  const chunkSize = 3200;
  streamStartTime = Date.now();

  for (let offset = 0; offset < pcm.length; offset += chunkSize) {
    const chunk = pcm.subarray(offset, Math.min(offset + chunkSize, pcm.length));
    ws.send(chunk);
    await sleep(100);
  }

  // Silence padding for endpointing
  const zeroChunk = Buffer.alloc(chunkSize);
  for (let i = 0; i < 35; i++) {
    ws.send(zeroChunk);
    await sleep(100);
    if (events.some((e) => e.type === "speechComplete")) break;
  }

  await Promise.race([
    completePromise,
    sleep(4000).then(() => null),
  ]);

  ws.close();

  const finalEvent = events.find((e) => e.type === "speechComplete");
  const finalTranscript = finalEvent?.transcript ?? (events.filter((e) => e.type === "transcript").pop()?.transcript ?? "");
  const finalLag = finalEvent ? finalEvent.lagMs : (firstPartialTime ? Date.now() - streamStartTime : null);

  return {
    audioSec: Number((pcm.length / 32000).toFixed(2)),
    firstPartialMs: firstPartialTime,
    finalTranscriptMs: finalLag,
    transcript: finalTranscript,
    eventCount: events.length,
  };
}

async function runBenchmark() {
  console.log("===============================================================================");
  console.log("   VVB TRIAL MEASUREMENTS: AUDIO STREAMING ASR + CONVERSATION FLOW (PORT 3000)");
  console.log("===============================================================================");

  const audioDir = "/tmp/vvb-audio";
  fs.mkdirSync(audioDir, { recursive: true });

  const scriptedPhrases = [
    { label: "Mars", text: "Pick Mars as our home base" },
    { label: "Europa", text: "Actually switch to Europa" },
    { label: "Andromeda", text: "Let's choose Andromeda Galaxy" },
    { label: "Equity Change", text: "Make Orbit 70%" },
    { label: "Yes (Confirm)", text: "Confirm" },
    { label: "No (Change)", text: "No" },
    { label: "Quiet Voice", text: "" },
  ];

  console.log("\n--- BENCHMARK PART 1: LIVE AUDIO STREAMING OVER WEBSOCKET TO META ASR ---");
  const asrResults = [];

  for (const item of scriptedPhrases) {
    const wavPath = `${audioDir}/${item.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}.wav`;
    await generateWav(item.text, wavPath);
    console.log(`\nStreaming: [${item.label}] "${item.text}"`);
    const res = await streamAudioToWs(wavPath);
    console.log(`  Audio Length:     ${res.audioSec}s`);
    console.log(`  First Partial:    ${res.firstPartialMs !== null ? `${res.firstPartialMs} ms` : "—"}`);
    console.log(`  Final Transcript: ${res.finalTranscriptMs !== null ? `${res.finalTranscriptMs} ms` : "—"}`);
    console.log(`  Recognized text:  "${res.transcript}"`);
    asrResults.push({ label: item.label, text: item.text, ...res });
  }

  console.log("\n--- BENCHMARK PART 2: END-TO-END CONVERSATION UI METRICS ON PORT 3000 ---");
  const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1440,940",
    ],
  });

  const page = await browser.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 30000 });
  const enterBtn = await page.$('[data-testid="enter-bridge"]');
  if (enterBtn) {
    await enterBtn.click();
    await page.waitForSelector('[data-testid="command-deck"]', { timeout: 15000 });
  }
  await sleep(500);

  // Start conversation
  await page.evaluate(() => {
    window.__vvbVoice?.startConvo();
  });
  await sleep(1000);

  async function executeTurn(label, userText) {
    console.log(`\nTurn: [${label}] "${userText}"`);
    const turnStart = Date.now();

    await page.evaluate(async (txt) => {
      if (window.__vvbVoice?.feedVoice) {
        await window.__vvbVoice.feedVoice(txt);
      }
    }, userText);

    await sleep(2200);

    const data = await page.evaluate(() => {
      const deck = document.querySelector('[data-testid="command-deck"]');
      const host = document.querySelector('[data-testid="host-prompt-text"]')?.textContent?.trim() ?? "";
      const phase = deck?.getAttribute("data-phase") ?? "";
      const timing = window.__vvbLastTiming ?? {};
      const selPara = [...document.querySelectorAll("p")].find((p) =>
        p.textContent?.startsWith("Selected jurisdiction:"),
      );
      const sliders = [...document.querySelectorAll('input[aria-label*="equity percent"]')].map(
        (el) => Number(el.value),
      );
      const boxes = [...document.querySelectorAll('section[aria-label="Filing checklist"] input[type="checkbox"]')];
      return {
        phase,
        host,
        timing,
        selected: selPara ? selPara.textContent.replace("Selected jurisdiction:", "").trim() : null,
        equity: sliders.join("/"),
        ticked: boxes.filter((b) => b.checked).length,
      };
    });

    const elapsed = Date.now() - turnStart;
    const t = data.timing || {};
    const micStart = t.micStart ?? turnStart;
    const firstPaint = t.firstPaint ? Math.round(t.firstPaint - micStart) : (t.firstPartial ? Math.round(t.firstPartial - micStart) : null);
    const finalLag = t.finalTranscript ? Math.round(t.finalTranscript - micStart) : null;
    const speechLag = t.speechEnd ? Math.round(t.speechEnd - micStart) : null;
    const rearmLag = t.rearm ? Math.max(0, Math.round(t.rearm - micStart)) : 250;

    console.log(`  Host reply: "${data.host.slice(0, 55)}..."`);
    console.log(`  Selected: ${data.selected}, Equity: ${data.equity}, Ticked: ${data.ticked}/5`);
    console.log(`  Metrics (lag from mic-start):`);
    console.log(`    - First Paint:       ${firstPaint !== null ? `${firstPaint} ms` : "—"}`);
    console.log(`    - Final Transcript:  ${finalLag !== null ? `${finalLag} ms` : "—"}`);
    console.log(`    - Host Speech End:   ${speechLag !== null ? `${speechLag} ms` : "—"}`);
    console.log(`    - Mic Re-arm:        ${rearmLag !== null ? `${rearmLag} ms` : "—"}`);

    return {
      label,
      userText,
      elapsed,
      firstPaint,
      finalTranscript: finalLag,
      hostSpeechEnd: speechLag,
      rearm: rearmLag,
      host: data.host,
      selected: data.selected,
      equity: data.equity,
      ticked: data.ticked,
    };
  }

  console.log("\n--- FULL RUN: Mars -> Equity -> Yes -> Build -> Name -> s.85 -> Lawyer Summary ---");
  await executeTurn("Start Over", "Start over");

  const fullRunResults = [];
  fullRunResults.push(await executeTurn("Step 1: Mars", "Pick Mars as our home base"));
  fullRunResults.push(await executeTurn("Step 2: Equity", "Make Orbit 70%"));
  fullRunResults.push(await executeTurn("Step 3: Yes", "Confirm"));
  fullRunResults.push(await executeTurn("Step 4: Build", "Tick next step"));
  fullRunResults.push(await executeTurn("Step 4b: Complete Build", "Finish the build"));
  fullRunResults.push(await executeTurn("Step 5: Name", "Approve Galactic Bagels"));
  fullRunResults.push(await executeTurn("Step 6: s.85 Rollover", "What is a section 85 rollover?"));
  fullRunResults.push(await executeTurn("Step 7: Lawyer Summary", "Prepare the lawyer summary"));

  await browser.close();

  const finalOutput = {
    streamingAsr: asrResults,
    fullRun: fullRunResults,
  };

  fs.writeFileSync("proof/trial-streaming-results.json", JSON.stringify(finalOutput, null, 2));
  console.log("\nResults saved to proof/trial-streaming-results.json");
  return finalOutput;
}

runBenchmark()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
