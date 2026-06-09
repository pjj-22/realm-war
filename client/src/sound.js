// Game sounds. File-first: if /sounds/<name>.mp3 exists it plays that;
// otherwise a small WebAudio synth stands in. Drop real files into
// client/public/sounds/ (horn, battle, capture, coin, fanfare).mp3

let ctx = null
const fileMode = new Map() // name -> 'file' | 'synth'

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

export function soundMuted() {
  return localStorage.getItem('rw_muted') === '1'
}

export function setSoundMuted(muted) {
  localStorage.setItem('rw_muted', muted ? '1' : '0')
}

async function modeFor(name) {
  if (fileMode.has(name)) return fileMode.get(name)
  let mode = 'synth'
  try {
    const r = await fetch(`/sounds/${name}.mp3`, { method: 'HEAD' })
    // Vite's SPA fallback returns index.html for missing files - require an audio type
    if (r.ok && (r.headers.get('content-type') || '').startsWith('audio')) mode = 'file'
  } catch { /* offline - synth */ }
  fileMode.set(name, mode)
  return mode
}

// One enveloped oscillator note
function tone({ freq, endFreq, type = 'sine', start = 0, dur = 0.2, vol = 0.12 }) {
  const a = ac()
  const t0 = a.currentTime + start
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

const synth = {
  // Ominous low war horn - incoming attack
  horn() {
    tone({ freq: 110, endFreq: 92, type: 'sawtooth', dur: 0.55, vol: 0.1 })
    tone({ freq: 110, endFreq: 92, type: 'square', dur: 0.55, vol: 0.04 })
    tone({ freq: 87, endFreq: 73, type: 'sawtooth', start: 0.5, dur: 0.7, vol: 0.11 })
  },
  // Clash - battle started / territory lost
  battle() {
    tone({ freq: 220, type: 'square', dur: 0.18, vol: 0.08 })
    tone({ freq: 233, type: 'square', dur: 0.18, vol: 0.08 })
    tone({ freq: 165, endFreq: 110, type: 'sawtooth', start: 0.14, dur: 0.3, vol: 0.1 })
  },
  // Rising chime - victory / hex captured
  capture() {
    tone({ freq: 523, dur: 0.12, vol: 0.1 })
    tone({ freq: 659, start: 0.09, dur: 0.12, vol: 0.1 })
    tone({ freq: 784, start: 0.18, dur: 0.22, vol: 0.11 })
  },
  // Coin blip - plunder / gold
  coin() {
    tone({ freq: 988, type: 'square', dur: 0.07, vol: 0.07 })
    tone({ freq: 1319, type: 'square', start: 0.07, dur: 0.14, vol: 0.08 })
  },
  // Triumphant fanfare - crowns / season end
  fanfare() {
    tone({ freq: 392, type: 'sawtooth', dur: 0.16, vol: 0.07 })
    tone({ freq: 494, type: 'sawtooth', start: 0.14, dur: 0.16, vol: 0.07 })
    tone({ freq: 587, type: 'sawtooth', start: 0.28, dur: 0.16, vol: 0.08 })
    tone({ freq: 784, type: 'sawtooth', start: 0.42, dur: 0.5, vol: 0.1 })
    tone({ freq: 392, type: 'triangle', start: 0.42, dur: 0.5, vol: 0.08 })
  },
}

export async function playSound(name) {
  if (soundMuted()) return
  try {
    if ((await modeFor(name)) === 'file') {
      const audio = new Audio(`/sounds/${name}.mp3`)
      audio.volume = 0.5
      audio.play().catch(() => {})
      return
    }
    synth[name]?.()
  } catch { /* audio unavailable (no user gesture yet) */ }
}

// Map dispatch types to sounds
const TYPE_SOUND = {
  incoming_attack: 'horn',
  under_attack: 'horn',
  battle_lost: 'battle',
  hex_lost: 'battle',
  capital_lost: 'battle',
  battle_won: 'capture',
  plunder: 'coin',
  crown: 'fanfare',
  season: 'fanfare',
}

export function playForEventType(type) {
  const name = TYPE_SOUND[type]
  if (name) playSound(name)
}
