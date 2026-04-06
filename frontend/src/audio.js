// Procedural audio feedback — no audio files needed
// Uses Web Audio API to generate sounds on the fly

let ctx = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browsers require user interaction first)
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Short click sound for pinch/select
export function playPinch() {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(800, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, c.currentTime + 0.05);

  gain.gain.setValueAtTime(0.15, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.08);
}

// Release sound
export function playRelease() {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(1000, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(600, c.currentTime + 0.06);

  gain.gain.setValueAtTime(0.1, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.06);
}

// Hover start — soft tone
export function playHover() {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(500, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(700, c.currentTime + 0.1);

  gain.gain.setValueAtTime(0.06, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.15);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.15);
}

// Dismiss — swoosh sound
export function playDismiss() {
  const c = getCtx();

  // Noise burst for swoosh
  const bufferSize = c.sampleRate * 0.3;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const noise = c.createBufferSource();
  noise.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(2000, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(400, c.currentTime + 0.25);
  filter.Q.value = 1;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.12, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  noise.start(c.currentTime);
  noise.stop(c.currentTime + 0.3);

  // Descending tone underneath
  const osc = c.createOscillator();
  const oscGain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(600, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.2);
  oscGain.gain.setValueAtTime(0.08, c.currentTime);
  oscGain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.2);
  osc.connect(oscGain);
  oscGain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.2);
}

// Respawn — rising tone
export function playRespawn() {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(300, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(900, c.currentTime + 0.15);

  gain.gain.setValueAtTime(0.08, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.2);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.2);
}
