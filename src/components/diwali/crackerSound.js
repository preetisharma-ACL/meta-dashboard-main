// Firecracker sounds for the Diwali theme, synthesised with Web Audio (no
// audio files to download). Kept quiet on purpose: a soft whistle on launch,
// a muffled thump with a crackle tail on the burst.
//
// Browsers only allow audio after the user has interacted with the page.
// Arriving on the dashboard from the login form counts, so sound usually
// plays straight away; on a cold reload it waits for the first click or key.
// Until then nothing is scheduled, so no backlog of bangs fires at once.

const VOLUME = 0.12;

let ctx = null;
let master = null;
let noise = null;

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = VOLUME;
  master.connect(ctx.destination);

  // One second of white noise, reused by every burst and crackle.
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const wake = () => {
    ctx.resume();
    if (ctx.state === "running") off();
  };
  const off = () => {
    window.removeEventListener("pointerdown", wake);
    window.removeEventListener("keydown", wake);
  };
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
  ctx.resume().then(() => ctx.state === "running" && off()).catch(() => {});
  return ctx;
}

function ready() {
  const a = audio();
  return a && a.state === "running" ? a : null;
}

// Stereo position from a 0..1 horizontal position on screen.
function panner(a, x) {
  if (!a.createStereoPanner) return master;
  const p = a.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, (x - 0.5) * 1.4));
  p.connect(master);
  return p;
}

function noiseHit(a, out, t, { type, freq, q = 1, peak, decay }) {
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5, decay + 0.05);
}

/** Rocket going up: a short rising whistle. x is 0..1 across the screen. */
export function launchSound(x = 0.5) {
  const a = ready();
  if (!a) return;
  const t = a.currentTime;
  const out = panner(a, x);
  const o = a.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(1100, t);
  o.frequency.exponentialRampToValueAtTime(2300, t + 0.55);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.65);
}

/** Burst: thump, a puff of noise, then a crackle of tiny pops. */
export function burstSound(x = 0.5, size = 1) {
  const a = ready();
  if (!a) return;
  const t = a.currentTime;
  const out = panner(a, x);

  const o = a.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9 * size, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.4);

  noiseHit(a, out, t, { type: "lowpass", freq: 1600, peak: 0.7 * size, decay: 0.45 });

  const pops = Math.round(8 + Math.random() * 10);
  for (let i = 0; i < pops; i++) {
    noiseHit(a, out, t + 0.18 + Math.random() * 0.75, {
      type: "bandpass",
      freq: 2500 + Math.random() * 4000,
      q: 2,
      peak: 0.12 + Math.random() * 0.18,
      decay: 0.015 + Math.random() * 0.02,
    });
  }
}
