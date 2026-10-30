// The effects' shapes, drawn once on small canvases when the game starts (nothing to download):
// a starburst for hits, a soft shockwave ring, sparkles and a six-point flare for good and
// perfect plays, a dust puff for bounces, a slash for deflects, and the ball's grippy rubber.
// White on transparent: each effect tints them with its own colour, and they glow additively.
import * as THREE from 'three';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c, colorSpace = THREE.SRGBColorSpace) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = colorSpace;
  return t;
}

/** A repeatable random sequence, so the shapes look the same every time. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function softDisc(g, x, y, r, alpha = 1) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
  grad.addColorStop(0.35, `rgba(255,255,255,${alpha * 0.55})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/** Thin spikes out of a bright core: an impact. */
function burst() {
  const [c, g] = canvas(256);
  const rnd = seeded(3);
  g.translate(128, 128);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    const len = 70 + rnd() * 54;
    const w = 0.06 + rnd() * 0.05;
    const grad = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(Math.cos(a - w) * 10, Math.sin(a - w) * 10);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.lineTo(Math.cos(a + w) * 10, Math.sin(a + w) * 10);
    g.closePath();
    g.fill();
  }
  softDisc(g, 0, 0, 46, 1);
  return texture(c);
}

/** A shockwave: a thin bright ring with a soft inner edge. */
function ring() {
  const [c, g] = canvas(256);
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0.0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.88, 'rgba(255,255,255,1)');
  grad.addColorStop(0.94, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return texture(c);
}

/** A star of `points` thin rays (4: a sparkle, 6: a flare) with a soft glow. */
function star(points, size = 128) {
  const [c, g] = canvas(size);
  const h = size / 2;
  g.translate(h, h);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const len = i % 2 && points > 4 ? h * 0.62 : h * 0.98;
    const grad = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(Math.cos(a + Math.PI / 2) * h * 0.07, Math.sin(a + Math.PI / 2) * h * 0.07);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.lineTo(Math.cos(a - Math.PI / 2) * h * 0.07, Math.sin(a - Math.PI / 2) * h * 0.07);
    g.closePath();
    g.fill();
  }
  softDisc(g, 0, 0, h * 0.42, 0.9);
  return texture(c);
}

/** A soft, lumpy cloud: dust from a bounce. */
function puff() {
  const [c, g] = canvas(128);
  const rnd = seeded(11);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 22;
    softDisc(g, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 26 + rnd() * 16, 0.32);
  }
  return texture(c);
}

/** A crescent swipe: a deflect's swat. */
function slash() {
  const [c, g] = canvas(256);
  g.translate(128, 128);
  g.lineCap = 'round';
  for (let k = 0; k < 7; k++) {          // layered strokes: thick and faint to thin and bright
    g.strokeStyle = `rgba(255,255,255,${0.12 + k * 0.12})`;
    g.lineWidth = 26 - k * 3.5;
    g.beginPath();
    g.arc(0, 0, 92, -0.25 * Math.PI, 0.95 * Math.PI);
    g.stroke();
  }
  // fade both tips: wipe from the ends with a gradient
  g.globalCompositeOperation = 'destination-out';
  for (const a of [-0.25 * Math.PI, 0.95 * Math.PI]) {
    const x = Math.cos(a) * 92;
    const y = Math.sin(a) * 92;
    const grad = g.createRadialGradient(x, y, 0, x, y, 70);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - 70, y - 70, 140, 140);
  }
  return texture(c);
}

/** The ball's grippy rubber: a field of small round bumps, as a normal map round the sphere
 *  (wraps left to right; the bumps squeeze towards the poles like the sphere's own layout). */
function pebbles() {
  const w = 256;
  const h = 128;
  const height = new Float32Array(w * h);
  const rnd = seeded(5);
  for (let n = 0; n < 1400; n++) {
    const cx = rnd() * w;
    const cy = rnd() * h;
    const r = 1.6 + rnd() * 1.6;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1) height[y * w + ((x + w) % w)] = Math.max(height[y * w + ((x + w) % w)], Math.sqrt(1 - d * d));
      }
    }
  }
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = height[y * w + ((x + 1) % w)] - height[y * w + ((x + w - 1) % w)];
      const dy = height[Math.min(h - 1, y + 1) * w + x] - height[Math.max(0, y - 1) * w + x];
      const nx = -dx * 1.4;
      const ny = dy * 1.4;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      img.data[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = texture(c, THREE.NoColorSpace);       // directions, not colours
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** A figure's long sun shadow: a soft capsule, darkest at the feet (u = 0) and lighter towards
 *  the head's end, as real shadows are further from what casts them. */
function longShadow() {
  const [c, g] = canvas(256, 64);
  const grad = g.createLinearGradient(8, 0, 248, 0);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.filter = 'blur(5px)';
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(12, 14, 232, 36, 18);
  g.fill();
  return texture(c);
}

/** A ball's sun shadow: a soft disc, solid in the middle. */
function roundShadow() {
  const [c, g] = canvas(64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.85)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return texture(c);
}

export function effectTextures() {
  return {
    burst: burst(), ring: ring(), sparkle: star(4), flare: star(6, 256), puff: puff(), slash: slash(), pebbles: pebbles(),
    longShadow: longShadow(), roundShadow: roundShadow(),
  };
}
