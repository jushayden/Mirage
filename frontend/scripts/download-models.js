import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelsDir = join(__dirname, "..", "public", "models");

const MODELS = [
  {
    name: "gesture_recognizer.task",
    url: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task",
  },
];

async function download(url, dest) {
  console.log(`Downloading ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
  console.log(`  → ${dest} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  mkdirSync(modelsDir, { recursive: true });

  for (const model of MODELS) {
    const dest = join(modelsDir, model.name);
    if (existsSync(dest)) {
      console.log(`${model.name} already exists, skipping`);
      continue;
    }
    await download(model.url, dest);
  }

  console.log("Models ready.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
