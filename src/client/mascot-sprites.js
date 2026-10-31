// Nib: original 40 × 36 pixel critter. No image downloads, tracing, or external assets.
// Every action uses the same head, muzzle, forked ears, chunky feet, and stepped tail.
export const SPRITE_WIDTH = 40;
export const SPRITE_HEIGHT = 36;
export const SPRITE_STATES = Object.freeze(['idle', 'notice', 'walk', 'run', 'jump', 'eat', 'attack', 'happy', 'sleep', 'hurt', 'evolve']);
export const FRAME_COUNTS = Object.freeze({ idle: 4, notice: 2, walk: 4, run: 4, jump: 3, eat: 4, attack: 3, happy: 4, sleep: 2, hurt: 2, evolve: 4 });
export const PALETTES = Object.freeze({
  cozy: ['transparent', '#192b32', '#a8e77a', '#69ad75', '#d9f5a4', '#fffbe8', '#192b32', '#f3a985', '#ffe0a9', '#db7776'],
  chaos: ['transparent', '#192b32', '#a8e77a', '#69ad75', '#d9f5a4', '#fffbe8', '#192b32', '#ffc85d', '#fff0b4', '#db7776'],
  mystic: ['transparent', '#192b32', '#a8e77a', '#69ad75', '#d9f5a4', '#fffbe8', '#192b32', '#bba1f3', '#eee0ff', '#db7776'],
});
export function generateSprite(state = 'idle', frame = 0, form = 'cozy', emotion = 'calm', gesture = {}) {
  if (!SPRITE_STATES.includes(state)) state = 'idle';
  frame = Math.abs(Math.floor(frame)) % FRAME_COUNTS[state];
  const w = SPRITE_WIDTH, h = SPRITE_HEIGHT;
  const mask = new Uint8Array(w * h), pixels = new Uint8Array(w * h);
  const fill = (target, x, y, width, height, value) => {
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(h, Math.round(y + height)); yy++)
      for (let xx = Math.max(0, Math.round(x)); xx < Math.min(w, Math.round(x + width)); xx++) target[yy * w + xx] = value;
  };
  const shape = (x, y, a, b) => fill(mask, x, y, a, b, 1);
  const paint = (x, y, a, b, value, inside = true) => {
    for (let yy = Math.max(0, y); yy < Math.min(h, y + b); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + a); xx++)
      if (!inside || pixels[yy * w + xx] > 1) pixels[yy * w + xx] = value;
  };
  const asleep = state === 'sleep';
  const bob = state === 'happy' ? [2,-1,-2,0][frame] : state === 'evolve' ? [2,-1,0,-2][frame] :
    state === 'eat' ? [0,1,-1,1][frame] : state === 'idle' ? [0,0,-1,0][frame] : ['walk', 'run'].includes(state) && frame % 2 ? 2 : 0;
  const squat = Math.max(state === 'hurt' || (state === 'jump' && frame === 0) ? 2 : 0, gesture.squat || 0);
  const oy = bob + squat;
  const tail = gesture.tailFrame === undefined ? [0,2,3,1][frame % 4] : gesture.tailFrame * 2;
  if (asleep) {
    shape(8, 23, 26, 10); shape(12, 20, 21, 13); shape(23, 17 + frame, 13, 14 - frame);
    shape(24, 14 + frame, 4, 9); shape(32, 15 + frame, 3, 8); shape(33, 23, 6, 7);
    shape(3, 25, 12, 7); shape(2, 21, 5, 9); shape(5, 20, 3, 4);
    shape(13, 31, 7, 3); shape(26, 31, 8, 3);
  } else {
    shape(11, 19 + oy, 21, 12 - squat); shape(9, 22 + oy, 25, 7 - squat);
    shape(13, 6 + oy, 20, 18 - squat); shape(11, 9 + oy, 25, 12 - squat);
    shape(16, 4 + oy, 14, 5); shape(30, 14 + oy, 9, 8 - squat);
    shape(12, 1 + oy, 5, 10); shape(11, 2 + oy, 3, 4); shape(27, 2 + oy, 5, 8);
    shape(5, 23, 9, 6); shape(2, 19 - tail, 5, 8 + tail); shape(1, 16 - tail, 4, 6);
    let left = 0, right = 0, liftL = 0, liftR = 0;
    if (['walk', 'run'].includes(state)) {
      const stride = state === 'run' ? 4 : 3;
      left = [0, -stride, 0, stride][frame]; right = -left;
      liftL = frame === 1 ? 4 : 0; liftR = frame === 3 ? 4 : 0;
      if (frame === 2) { liftL = 1; liftR = 1; }
    }
    if (state === 'jump' && frame === 1) { left = -2; right = 2; liftL = 4; liftR = 3; }
    shape(12 + left, 29 - liftL, 8, 5); shape(25 + right, 29 - liftR, 8, 5);
    shape(state === 'attack' ? 30 : 27, 24 + bob, state === 'attack' ? 8 : 7, 4);
    if (['happy','evolve'].includes(state)) {
      const lift = [1,7,9,3][frame];
      shape(7,22-lift,7,5); shape(32,21-lift,7,5);
      shape(8,25-lift,5,5); shape(33,24-lift,5,5);
    }
    if (state === 'attack') { shape(31,20-frame,8,7); shape(7,23+frame,7,5); }
    if (state === 'eat') { shape(30,23-frame,8,5); shape(25,25-frame,8,4); }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[y * w + x - 1] || !mask[y * w + x + 1] || !mask[(y - 1) * w + x] || !mask[(y + 1) * w + x];
    pixels[y * w + x] = edge ? 1 : y > (asleep ? 28 : 25 + oy) ? 3 : 2;
  }
  if (asleep) {
    paint(12, 23, 9, 3, 4); paint(25, 26, 10, 2, 7); paint(26, 16 + frame, 1, 2, 7);
    paint(32, 17 + frame, 1, 2, 7); paint(28, 23 + frame, 5, 1, 6); paint(34, 27, 2, 1, 6);
  } else {
    paint(14, 8 + oy, 3, 9, 4); paint(17, 6 + oy, 10, 2, 4);
    paint(15, 24 + oy, 9, 4 - squat, 4); paint(13, 2 + oy, 2, 3, 7); paint(28, 3 + oy, 2, 2, 7);
    paint(2, 17 - tail, 2, 3, 7); paint(11, 22 + oy, 15, 2, 7); paint(12, 24 + oy, 3, 4, 7);
    paint(18, 17 + oy, 3, 2, 7);
    const blink = state === 'idle' && frame === 2;
    if (state === 'hurt') {
      for (const ex of [20, 29]) { paint(ex, 11 + oy, 1, 1, 6); paint(ex + 2, 11 + oy, 1, 1, 6); paint(ex + 1, 12 + oy, 1, 1, 6); paint(ex, 13 + oy, 1, 1, 6); paint(ex + 2, 13 + oy, 1, 1, 6); }
    } else if (state === 'happy' || blink) {
      for (const ex of [19, 28]) { paint(ex, 12 + oy, 1, 1, 6); paint(ex + 1, 11 + oy, 2, 1, 6); paint(ex + 3, 12 + oy, 1, 1, 6); }
    } else {
      for (const ex of [18, 27]) {
        paint(ex, 9 + oy, 6, 7, 5); paint(ex + (state === 'notice' ? 3 : 2), 11 + oy, 3, 4, 6);
        paint(ex + (state === 'notice' ? 4 : 3), 11 + oy, 1, 1, 5);
      }
    }
    paint(32, 16 + oy, 2, 1, 6);
    const open = !gesture.softSmile && (state === 'eat' && (frame === 1 || frame === 2) || state === 'attack' || state === 'happy');
    if (open) {
      paint(25, 18 + oy, 12, 5, 6); paint(26, 18 + oy, 2, 2, 5); paint(32, 18 + oy, 2, 2, 5);
      paint(29, 21 + oy, 5, 1, 9);
    } else { paint(27, 20 + oy, 9, 1, 6); paint(26, 19 + oy, 1, 1, 6); }
    if (state === 'attack') { paint(19, 9 + oy, 2, 1, 6); paint(21, 10 + oy, 3, 1, 6); paint(28, 9 + oy, 2, 1, 6); }
    // Evolution changes only small accents/accessories; the body and mascot identity stay intact.
    if (form === 'chaos' || state === 'evolve') { paint(19, 2 + oy, 3, 2, 7, false); paint(20, 1 + oy, 1, 1, 8, false); }
    if (form === 'mystic') { paint(24, 6 + oy, 1, 3, 8); paint(23, 7 + oy, 3, 1, 8); }
    // Expressions layer over every action. Nib can be grumpy while eating or jumping.
    if (emotion === 'anger' && state !== 'hurt') {
      paint(18, 8 + oy, 2, 1, 6); paint(20, 9 + oy, 3, 1, 6);
      paint(28, 9 + oy, 2, 1, 6); paint(30, 8 + oy, 3, 1, 6);
      paint(18, 16 + oy, 3, 2, 9); paint(29, 16 + oy, 3, 2, 9);
      if (!open) { paint(27, 20 + oy, 9, 1, 2); paint(28, 19 + oy, 5, 1, 6); paint(27, 20 + oy, 1, 1, 6); paint(33, 20 + oy, 1, 1, 6); }
    }
    if (emotion === 'laughter' && state !== 'hurt') {
      for (const ex of [18, 27]) { paint(ex, 9 + oy, 6, 7, 2); paint(ex + 1, 11 + oy, 2, 1, 6); paint(ex, 12 + oy, 1, 1, 6); paint(ex + 3, 12 + oy, 1, 1, 6); }
    }
    if (emotion === 'confusion' && state !== 'hurt') {
      paint(18, 8 + oy, 4, 1, 6); paint(28, 7 + oy, 3, 1, 6);
      paint(18, 9 + oy, 6, 7, 5); paint(19 + frame % 2, 10 + oy, 2, 4, 6);
      if (!open) { paint(26, 19 + oy, 10, 2, 2); paint(30, 19 + oy, 2, 2, 6); }
    }
    if (gesture.softSmile && emotion !== 'anger') {
      paint(26, 19 + oy, 11, 3, 2); paint(27, 19 + oy, 1, 1, 6);
      paint(28, 20 + oy, 6, 1, 6); paint(34, 19 + oy, 1, 1, 6);
    }
    if (gesture.arms) {
      paint(23, 25 + bob, 10, 3, 3); paint(24, 25 + bob, 8, 1, 6);
      paint(27, 26 + bob, 2, 2, 6); paint(24, 26 + bob, 2, 1, 4);
    }
    // A stepped head shear keeps tilted poses crisp: no rotated/interpolated bitmap.
    if (gesture.headTilt) {
      const original = pixels.slice(), cutoff = 21 + oy, tilt = Math.sign(gesture.headTilt);
      for (let y = 0; y <= cutoff; y++) for (let x = 11; x < w; x++) pixels[y * w + x] = 0;
      for (let y = 0; y <= cutoff; y++) for (let x = 11; x < w; x++) {
        const color = original[y * w + x], yy = y + (x < 25 ? -tilt : tilt);
        if (color && yy >= 0 && yy < h) pixels[yy * w + x] = color;
      }
    }
  }
  const palette = [...(PALETTES[form] || PALETTES.cozy)];
  const accent = { laughter: '#71C9B0', excitement: '#F0B45A', anger: '#E47770', confusion: '#B29AD8' }[emotion];
  if (accent) palette[7] = accent;
  return { width: w, height: h, pixels, palette };
}

// Cache CPU-side pixel spans, not offscreen canvas bitmaps that can lose their backing store.
export function compileSprite(state, frame, form, emotion = 'calm', gesture = {}) {
  const sprite = generateSprite(state, frame, form, emotion, gesture), colors = new Map();
  for (let y = 0; y < sprite.height; y++) {
    let x = 0;
    while (x < sprite.width) {
      const color = sprite.pixels[y * sprite.width + x], start = x++;
      while (x < sprite.width && sprite.pixels[y * sprite.width + x] === color) x++;
      if (color) {
        if (!colors.has(color)) colors.set(color, []);
        colors.get(color).push({ x: start, y, width: x - start });
      }
    }
  }
  return { width: sprite.width, height: sprite.height, palette: sprite.palette, colors };
}
