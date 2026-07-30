// Player capital flags: a 16x16 pixel grid, one character per pixel indexing
// into a fixed 24-color palette. Fixed palette (not free RGB picking) keeps
// every flag in the same visual style and keeps storage trivial - a flag is
// just a 256-character string, one palette-index char per pixel.

export const FLAG_SIZE = 16
export const PALETTE_CHARS = '0123456789abcdefghijklmn' // 24 slots

export const PALETTE = [
  '#f5f2e8', // 0 parchment white
  '#1a1a1a', // 1 near black
  '#9e9e9e', // 2 gray
  '#4a4a4a', // 3 dark gray
  '#8b5a2b', // 4 brown
  '#d9b384', // 5 tan
  '#e8442f', // 6 red
  '#7a1f1f', // 7 dark red
  '#e8821a', // 8 orange
  '#f0c419', // 9 gold
  '#f5e94e', // a bright yellow
  '#9acd32', // b yellow-green
  '#3f8f3f', // c green
  '#1f5c1f', // d dark green
  '#2ec4c4', // e teal
  '#4169e1', // f royal blue
  '#1f3fae', // g blue
  '#12205c', // h navy
  '#7b3fbf', // i violet
  '#3a1f7a', // j indigo
  '#e0398f', // k pink
  '#d9a6e0', // l light purple
  '#e8d98a', // m khaki
  '#a5482e', // n rust
]

function paletteColor(ch) {
  const i = PALETTE_CHARS.indexOf(ch)
  return PALETTE[i >= 0 ? i : 0]
}

function grid(fn) {
  const arr = new Array(FLAG_SIZE * FLAG_SIZE)
  for (let y = 0; y < FLAG_SIZE; y++) {
    for (let x = 0; x < FLAG_SIZE; x++) arr[y * FLAG_SIZE + x] = fn(x, y)
  }
  return arr
}

// Each pattern assigns a "role" (0=background, 1=primary, 2=secondary,
// 3=accent) per pixel. Combined with a color scheme (4 concrete colors, one
// per role) at apply-time, 12 patterns x 12 schemes gives 144 starting
// points before anyone touches a single pixel by hand.
export const PATTERNS = [
  { id: 'stripes-h', name: 'Horizontal Bands', grid: grid((x, y) => [1, 2, 1, 2][Math.floor(y / 4)]) },
  { id: 'stripes-v', name: 'Vertical Bands', grid: grid((x, y) => [1, 2, 1, 2][Math.floor(x / 4)]) },
  {
    id: 'cross', name: 'Cross', grid: grid((x, y) => {
      const vInner = x >= 5 && x <= 6
      const hInner = y >= 7 && y <= 8
      const vOuter = x >= 4 && x <= 7
      const hOuter = y >= 6 && y <= 9
      if (vInner || hInner) return 1
      if (vOuter || hOuter) return 2
      return 0
    }),
  },
  {
    id: 'saltire', name: 'Saltire', grid: grid((x, y) => {
      const d1 = Math.abs(x - y) <= 1
      const d2 = Math.abs(x - (15 - y)) <= 1
      return (d1 || d2) ? 1 : 0
    }),
  },
  {
    id: 'canton', name: 'Canton', grid: grid((x, y) => {
      if (x < 8 && y < 8) return 2
      return Math.floor(y / 2) % 2 === 0 ? 0 : 1
    }),
  },
  {
    id: 'chevron', name: 'Chevron', grid: grid((x, y) => {
      const a = Math.abs(y - 7.5 - x) < 1.6
      const b = Math.abs(y - 7.5 + x) < 1.6
      return (a || b) ? 1 : 0
    }),
  },
  {
    id: 'frame', name: 'Frame', grid: grid((x, y) => {
      if (x < 2 || x > 13 || y < 2 || y > 13) return 2
      if (x < 3 || x > 12 || y < 3 || y > 12) return 3
      return 1
    }),
  },
  {
    id: 'checker', name: 'Checkerboard', grid: grid((x, y) => {
      const bx = Math.floor(x / 4), by = Math.floor(y / 4)
      return (bx + by) % 2 === 0 ? 1 : 2
    }),
  },
  {
    id: 'quarters', name: 'Quarters', grid: grid((x, y) => {
      const left = x < 8, top = y < 8
      if (top && left) return 0
      if (top && !left) return 1
      if (!top && left) return 2
      return 3
    }),
  },
  {
    id: 'diamond', name: 'Diamond', grid: grid((x, y) => {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5)
      if (d < 3) return 2
      if (d < 6) return 1
      return 0
    }),
  },
  {
    id: 'sunburst', name: 'Sunburst', grid: grid((x, y) => {
      const dx = x - 7.5, dy = y - 7.5
      const r = Math.sqrt(dx * dx + dy * dy)
      if (r < 2) return 3
      if (r > 7.5) return 0
      const angle = Math.atan2(dy, dx)
      const sector = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 12)
      return sector % 2 === 0 ? 2 : 1
    }),
  },
  {
    id: 'tricolor', name: 'Tricolor', grid: grid((x, y) => {
      if (x < 5) return 1
      if (x < 11) return 2
      return 3
    }),
  },
]

// [background, primary, secondary, accent]
export const SCHEMES = [
  { id: 'royal', name: 'Royal', colors: ['h', '9', '0', '7'] },
  { id: 'forest', name: 'Forest', colors: ['d', 'c', '5', '4'] },
  { id: 'blood-iron', name: 'Blood & Iron', colors: ['1', '7', '2', '0'] },
  { id: 'ocean', name: 'Ocean', colors: ['h', 'f', 'e', '0'] },
  { id: 'sunset', name: 'Sunset', colors: ['8', '9', '7', 'i'] },
  { id: 'desert', name: 'Desert', colors: ['5', '4', '9', 'n'] },
  { id: 'imperial', name: 'Imperial Purple', colors: ['j', 'i', '9', '0'] },
  { id: 'monochrome', name: 'Monochrome', colors: ['1', '3', '2', '0'] },
  { id: 'spring', name: 'Spring', colors: ['0', 'b', 'c', 'a'] },
  { id: 'rose', name: 'Rose', colors: ['0', 'k', 'l', '7'] },
  { id: 'storm', name: 'Storm', colors: ['h', '3', 'e', '1'] },
  { id: 'harvest', name: 'Harvest', colors: ['9', 'n', '4', '7'] },
]

export function applyPatternScheme(patternGrid, schemeColors) {
  return patternGrid.map(role => schemeColors[role]).join('')
}

export function isValidFlagString(s) {
  return typeof s === 'string' && new RegExp(`^[${PALETTE_CHARS}]{256}$`).test(s)
}

function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h >>> 0
}

// Deterministic RNG so a username always produces the same "no flag saved
// yet" fallback flag (bots never go through onboarding, and a player who
// dismisses the editor still needs *something* consistent to render).
function mulberry32(seed) {
  let t = seed
  return function () {
    t = (t + 0x6D2B79F5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function randomFlagString(seed) {
  const rand = seed != null ? mulberry32(seed) : Math.random
  const pattern = PATTERNS[Math.floor(rand() * PATTERNS.length)]
  const scheme = SCHEMES[Math.floor(rand() * SCHEMES.length)]
  return applyPatternScheme(pattern.grid, scheme.colors)
}

export function defaultFlagForUsername(username) {
  return randomFlagString(hashString(username || 'unknown'))
}

// Always returns a valid 256-char flag string, real or a stable fallback.
export function resolveFlag(player) {
  if (isValidFlagString(player?.flag_pixels)) return player.flag_pixels
  return defaultFlagForUsername(player?.username)
}

export function flagImageId(ownerId, flagString) {
  return `flag-${ownerId}-${hashString(flagString).toString(36)}`
}

export function drawFlagToCanvas(flagString, canvas, px = 8) {
  canvas.width = FLAG_SIZE * px
  canvas.height = FLAG_SIZE * px
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < FLAG_SIZE; y++) {
    for (let x = 0; x < FLAG_SIZE; x++) {
      ctx.fillStyle = paletteColor(flagString[y * FLAG_SIZE + x])
      ctx.fillRect(x * px, y * px, px, px)
    }
  }
  return canvas
}

function hexToRgb(hex) {
  const v = hex.replace('#', '')
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

// Raw RGBA buffer in the shape maplibre's map.addImage() expects.
export function flagToImageData(flagString, px = 4) {
  const size = FLAG_SIZE * px
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < FLAG_SIZE; y++) {
    for (let x = 0; x < FLAG_SIZE; x++) {
      const [r, g, b] = hexToRgb(paletteColor(flagString[y * FLAG_SIZE + x]))
      for (let py = 0; py < px; py++) {
        for (let pxx = 0; pxx < px; pxx++) {
          const gx = x * px + pxx, gy = y * px + py
          const o = (gy * size + gx) * 4
          data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255
        }
      }
    }
  }
  return { width: size, height: size, data }
}
