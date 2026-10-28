// Audio-reactive orb drawn on a canvas.
//
// Every number that reaches the canvas goes through `finite()`, so a NaN or
// Infinity from an audio level or a zero-sized canvas can never stall the loop,
// and the geometry is sized so the blob plus its glow always fit inside the canvas.

const MODES = ["idle", "connecting", "listening", "speaking", "muted"];
const POINTS = 96;

function finite(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, finite(v)));
}

function hexToRgb(value, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba([r, g, b], a) {
  return `rgba(${r}, ${g}, ${b}, ${clamp01(a)})`;
}

function mix(a, b, t) {
  const k = clamp01(t);
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k));
}

export class Orb {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.mode = "idle";
    this.micLevel = 0;
    this.botLevel = 0;
    this.level = 0; // smoothed level actually drawn
    this.energy = 0; // smoothed mode intensity
    this.t = 0;
    this.last = performance.now();
    this.size = 0;
    this.dpr = 1;
    this.readColors();

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    this.resize();
    requestAnimationFrame(this.frame);
  }

  readColors() {
    const css = getComputedStyle(document.documentElement);
    const get = (name, fb) => hexToRgb(css.getPropertyValue(name), fb);
    this.colors = {
      accent: get("--accent", [167, 139, 250]),
      accent2: get("--accent-2", [240, 171, 252]),
      strong: get("--accent-strong", [139, 92, 246]),
      danger: get("--danger", [244, 63, 94]),
      dim: get("--text-dim", [125, 114, 163]),
      bg: get("--bg", [15, 10, 31]),
    };
  }

  setMode(mode) {
    if (MODES.includes(mode)) this.mode = mode;
  }

  setMicLevel(v) {
    this.micLevel = clamp01(v);
  }

  setBotLevel(v) {
    this.botLevel = clamp01(v);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(3, Math.max(1, finite(window.devicePixelRatio, 1)));
    this.size = Math.max(0, finite(Math.min(rect.width, rect.height)));
    const px = Math.max(1, Math.round(this.size * this.dpr));
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
  }

  frame(now) {
    // Schedule first so an exception in drawing can never stop the animation.
    requestAnimationFrame(this.frame);
    try {
      const dt = Math.min(0.1, Math.max(0, finite((now - this.last) / 1000)));
      this.last = finite(now, performance.now());
      this.step(dt);
      this.draw();
    } catch (err) {
      this.level = 0;
      this.energy = 0;
      this.t = 0;
      console.warn("orb frame skipped", err);
    }
  }

  step(dt) {
    this.t = finite(this.t + dt) % 3600;

    let target = 0;
    let energyTarget = 0.15;
    switch (this.mode) {
      case "listening":
        target = this.micLevel;
        energyTarget = 0.55;
        break;
      case "speaking":
        target = this.botLevel;
        energyTarget = 0.8;
        break;
      case "connecting":
        target = 0.25 + 0.15 * Math.sin(this.t * 5);
        energyTarget = 0.45;
        break;
      case "muted":
        energyTarget = 0.1;
        break;
    }
    // Shape the raw level so quiet speech still shows.
    target = Math.sqrt(clamp01(target));

    // Fast attack, slower release.
    const k = target > this.level ? 1 - Math.exp(-dt * 18) : 1 - Math.exp(-dt * 5);
    this.level = clamp01(this.level + (target - this.level) * k);
    this.energy = clamp01(this.energy + (energyTarget - this.energy) * (1 - Math.exp(-dt * 4)));
  }

  palette() {
    const c = this.colors;
    if (this.mode === "muted") return { core: mix(c.dim, c.danger, 0.35), edge: c.dim, glow: c.danger };
    if (this.mode === "idle") return { core: mix(c.accent, c.dim, 0.35), edge: c.strong, glow: c.accent };
    if (this.mode === "speaking") return { core: c.accent2, edge: c.strong, glow: c.accent2 };
    return { core: c.accent, edge: c.strong, glow: c.accent };
  }

  draw() {
    const { ctx, dpr } = this;
    const size = this.size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (size < 8) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = size / 2;
    const half = size / 2;

    // Budget: base radius + wobble + glow <= 96% of half the canvas.
    const base = half * 0.5;
    const maxWobble = half * 0.14;
    const glowWidth = half * 0.3;
    const breathe = 0.02 * Math.sin(this.t * 1.6);
    const level = this.level;
    const r = finite(base * (1 + breathe + level * 0.18));
    const wobble = finite(maxWobble * (0.12 + level * 0.88) * (0.4 + this.energy));
    const pal = this.palette();

    // Glow: a radial gradient that fades to transparent before the canvas edge.
    const glowOuter = Math.min(half * 0.98, r + wobble + glowWidth);
    const glow = ctx.createRadialGradient(c, c, r * 0.6, c, c, glowOuter);
    glow.addColorStop(0, rgba(pal.glow, 0.35 + level * 0.35));
    glow.addColorStop(0.55, rgba(pal.glow, 0.12 + level * 0.15));
    glow.addColorStop(1, rgba(pal.glow, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c, c, glowOuter, 0, Math.PI * 2);
    ctx.fill();

    // Blob outline from a few layered sine waves.
    const t = this.t;
    const speed = this.mode === "speaking" ? 2.2 : this.mode === "listening" ? 1.6 : 0.7;
    ctx.beginPath();
    for (let i = 0; i <= POINTS; i++) {
      const a = (i / POINTS) * Math.PI * 2;
      const n =
        Math.sin(a * 3 + t * speed) * 0.5 +
        Math.sin(a * 5 - t * speed * 1.3) * 0.3 +
        Math.sin(a * 2 + t * speed * 0.6 + 1.7) * 0.2;
      const rr = Math.max(1, finite(r + n * wobble, r));
      const x = c + Math.cos(a) * rr;
      const y = c + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    const fill = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r + wobble);
    fill.addColorStop(0, rgba([255, 255, 255], 0.9));
    fill.addColorStop(0.25, rgba(pal.core, 0.95));
    fill.addColorStop(1, rgba(pal.edge, 0.95));
    ctx.fillStyle = fill;
    ctx.fill();

    // Inner sheen.
    ctx.save();
    ctx.clip();
    const sheen = ctx.createLinearGradient(c - r, c - r, c + r, c + r);
    sheen.addColorStop(0, rgba([255, 255, 255], 0.18));
    sheen.addColorStop(0.5, rgba([255, 255, 255], 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(c - r - wobble, c - r - wobble, (r + wobble) * 2, (r + wobble) * 2);
    ctx.restore();

    // Connecting: a spinning arc just outside the blob, still inside the glow budget.
    if (this.mode === "connecting") {
      const ringR = Math.min(half * 0.92, r + wobble + half * 0.08);
      const start = (t * 3) % (Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, half * 0.025);
      ctx.lineCap = "round";
      ctx.strokeStyle = rgba(pal.glow, 0.9);
      ctx.beginPath();
      ctx.arc(c, c, ringR, start, start + Math.PI * 0.6);
      ctx.stroke();
    }

    // Muted: a slash across the orb.
    if (this.mode === "muted") {
      ctx.lineWidth = Math.max(2, half * 0.04);
      ctx.lineCap = "round";
      ctx.strokeStyle = rgba(this.colors.bg, 0.75);
      ctx.beginPath();
      ctx.moveTo(c - r * 0.45, c - r * 0.45);
      ctx.lineTo(c + r * 0.45, c + r * 0.45);
      ctx.stroke();
    }
  }
}
