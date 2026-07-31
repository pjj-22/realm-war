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

// ── Ambient background music ─────────────────────────────────────────────
// File-first like everything else here: drop /sounds/ambient.mp3 (looping,
// pre-mixed) and it'll play that. Otherwise a small procedural generator
// stands in - a sustained low drone (bordun, the medieval trick of droning
// a bass note under a modal tune) plus a sparse plucked melody in D dorian,
// the mode most Gregorian-chant/early-music "medieval" cues actually use.

export function musicEnabled() {
  return localStorage.getItem('rw_music') === '1'
}

let activeMusic = null // { stop() } | null

export function setMusicEnabled(on) {
  localStorage.setItem('rw_music', on ? '1' : '0')
  if (on) startMusic()
  else stopMusic()
}

async function startMusic() {
  if (activeMusic) return
  try {
    if ((await modeFor('ambient')) === 'file') {
      const audio = new Audio('/sounds/ambient.mp3')
      audio.loop = true
      audio.volume = 0.28
      await audio.play()
      activeMusic = { stop: () => audio.pause() }
      return
    }
    activeMusic = startSynthMusic()
  } catch { /* no user gesture yet - toggle button click supplies one on retry */ }
}

function stopMusic() {
  activeMusic?.stop()
  activeMusic = null
}

// D dorian, root through the octave above - the scale under most
// "medieval" modal melodies (E is the classic reference: white keys D-D).
const DORIAN = [146.83, 164.81, 174.61, 196.00, 220.00, 246.94, 261.63, 293.66]
const DRONE_ROOT = 73.42 // D2, an octave under the scale

// A short stepwise folk-tune motif (scale degrees into DORIAN, null = rest),
// not randomly-picked notes - random note choice is what read as "beeps"
// rather than music. Two related halves so the loop doesn't feel too static.
const MOTIF = [
  0, null, 2, 3, null, 2, 1, 0, null, null,
  4, null, 3, 2, null, 3, 4, 2, 0, null, null, null,
]
const BEAT_SEC = 0.42

function startSynthMusic() {
  const a = ac()

  // Everything routes through one master gain so stop() can silence
  // instantly, regardless of how many notes are already scheduled ahead.
  const master = a.createGain()
  master.gain.value = 1
  master.connect(a.destination)

  const liveNodes = [] // every oscillator we start, so stop() can kill pending ones too

  const droneGain = a.createGain()
  droneGain.gain.value = 0
  droneGain.connect(master)
  droneGain.gain.linearRampToValueAtTime(0.03, a.currentTime + 2.5)
  for (const freq of [DRONE_ROOT, DRONE_ROOT * 1.5]) { // root + fifth, bagpipe-style
    const osc = a.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    osc.connect(droneGain)
    osc.start()
    liveNodes.push(osc)
  }

  function pluck(freq, time) {
    const filter = a.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1600 // rounds off the raw triangle wave's edge - less "beepy", more plucked-string
    const gain = a.createGain()
    const osc = a.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(0.05, time + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.1)
    osc.connect(filter).connect(gain).connect(master)
    osc.start(time)
    osc.stop(time + 1.2)
    liveNodes.push(osc)
  }

  // Standard lookahead scheduler: a cheap setInterval tick keeps queuing
  // audio-clock-timed notes a little ahead of playback, instead of chaining
  // setTimeout calls whose drift compounds against the audio clock.
  let motifStep = 0
  let nextNoteTime = a.currentTime + 0.3
  const LOOKAHEAD = 0.3
  const intervalId = setInterval(() => {
    while (nextNoteTime < a.currentTime + LOOKAHEAD) {
      const degree = MOTIF[motifStep % MOTIF.length]
      if (degree != null) pluck(DORIAN[degree], nextNoteTime)
      nextNoteTime += BEAT_SEC
      motifStep++
    }
  }, 100)

  return {
    stop() {
      clearInterval(intervalId)
      // Fast fade kills anything audible right now; explicit stop() on every
      // node (including ones scheduled but not yet started) clears anything
      // still queued so it doesn't play out after the fade completes.
      master.gain.cancelScheduledValues(a.currentTime)
      master.gain.linearRampToValueAtTime(0, a.currentTime + 0.12)
      liveNodes.forEach(o => { try { o.stop(a.currentTime) } catch { /* already stopped */ } })
    },
  }
}

// Music preference persists across sessions, but AudioContext starts
// suspended until a real user gesture - if music was left on last visit,
// arm a one-time click listener to resume it instead of failing silently.
if (typeof document !== 'undefined' && musicEnabled()) {
  const resume = () => { startMusic(); document.removeEventListener('click', resume) }
  document.addEventListener('click', resume, { once: true })
}
