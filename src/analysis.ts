/** Offline track analysis: BPM (energy autocorrelation) + rough key (chroma + Krumhansl). */

export type TrackAnalysis = {
  bpm: number
  /** e.g. "Am" or "C# major" */
  keyLabel: string
  /** Camelot-style tag e.g. "8A" or "—" */
  camelot: string
}

/**
 * Fractional position in the current beat (0…1) from wall-time position in the buffer
 * and effective musical BPM (nominal file BPM × playback rate).
 * Phase 0 is aligned to t = 0 in the file (not true downbeat — use for visuals / relative sync).
 */
export function beatPhase01(effectiveBpm: number, tSecInBuffer: number): number {
  if (!(effectiveBpm > 0) || !Number.isFinite(tSecInBuffer) || tSecInBuffer < 0) return 0
  const beats = (tSecInBuffer * effectiveBpm) / 60
  return beats - Math.floor(beats)
}

/**
 * Smallest time shift (seconds) to add to the **slave** deck’s buffer position so its
 * beat phase matches `phaseMaster01`, using the slave’s effective BPM for beat length.
 * Picks the shortest of the three candidates (± one beat).
 */
export function beatPhaseNudgeSec(
  effectiveBpmSlave: number,
  phaseMaster01: number,
  phaseSlave01: number,
): number {
  if (!(effectiveBpmSlave > 40)) return 0
  const f = effectiveBpmSlave / 60
  let d = phaseMaster01 - phaseSlave01
  while (d > 0.5) d -= 1
  while (d < -0.5) d += 1
  const c0 = d / f
  const c1 = (d + 1) / f
  const c2 = (d - 1) / f
  let best = c0
  let bestAbs = Math.abs(c0)
  for (const c of [c1, c2]) {
    const a = Math.abs(c)
    if (a < bestAbs) {
      best = c
      bestAbs = a
    }
  }
  return best
}

/** Krumhansl–Schmuckler key profiles (C as index 0 = C pitch class strength). */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Camelot codes by major / minor root pitch class (C = 0). */
const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B']
const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A']

function rotateProfile(profile: readonly number[], root: number): number[] {
  const out = new Array<number>(12)
  for (let i = 0; i < 12; i++) {
    out[i] = profile[(i - root + 12) % 12]!
  }
  return out
}

function correlate(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < 12; i++) s += a[i]! * b[i]!
  return s
}

function normalizeChroma(ch: number[]): number[] {
  const m = Math.sqrt(ch.reduce((x, v) => x + v * v, 0)) || 1
  return ch.map((v) => v / m)
}

function goertzelMag(samples: Float32Array, sr: number, freq: number, offset: number, len: number): number {
  const k = Math.round((len * freq) / sr)
  const omega = (2 * Math.PI * k) / len
  let s = 0
  let s2 = 0
  for (let i = 0; i < len; i++) {
    const x = samples[offset + i] ?? 0
    s += x * Math.cos(omega * i)
    s2 += x * Math.sin(omega * i)
  }
  return Math.sqrt(s * s + s2 * s2) / len
}

function buildChroma(buffer: AudioBuffer): number[] {
  const ch0 = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const len = buffer.length
  const win = 8192
  const step = 4096
  const chroma = new Array(12).fill(0)
  let windows = 0
  const f0 = 261.63
  for (let start = 0; start + win < len; start += step) {
    windows++
    for (let p = 0; p < 12; p++) {
      const freq = f0 * Math.pow(2, p / 12)
      let m = goertzelMag(ch0, sr, freq, start, win)
      m += 0.45 * goertzelMag(ch0, sr, freq * 2, start, win)
      chroma[p] += m
    }
  }
  if (windows === 0) return chroma.map(() => 0)
  return chroma.map((v) => v / windows)
}

export function estimateKey(buffer: AudioBuffer): { keyLabel: string; camelot: string } {
  const raw = buildChroma(buffer)
  const ch = normalizeChroma(raw)
  let best = -Infinity
  let bestRoot = 0
  let bestMinor = false
  for (let root = 0; root < 12; root++) {
    const majP = rotateProfile(MAJOR_PROFILE, root)
    const minP = rotateProfile(MINOR_PROFILE, root)
    const cM = correlate(ch, normalizeChroma(majP))
    const cm = correlate(ch, normalizeChroma(minP))
    if (cM > best) {
      best = cM
      bestRoot = root
      bestMinor = false
    }
    if (cm > best) {
      best = cm
      bestRoot = root
      bestMinor = true
    }
  }
  const name = NOTE_NAMES[bestRoot]!
  const keyLabel = bestMinor ? `${name}m` : `${name} major`
  const camelot = bestMinor ? CAMELOT_MINOR[bestRoot]! : CAMELOT_MAJOR[bestRoot]!
  return { keyLabel, camelot }
}

export function estimateBpm(buffer: AudioBuffer): number {
  const ch0 = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const hop = Math.max(256, Math.floor(sr * 0.01))
  const env: number[] = []
  for (let i = 0; i < ch0.length; i += hop) {
    let m = 0
    for (let j = 0; j < hop && i + j < ch0.length; j++) {
      const v = Math.abs(ch0[i + j]!)
      if (v > m) m = v
    }
    env.push(m)
  }
  const smooth = 5
  const e2 = env.map((_, i) => {
    let s = 0
    let c = 0
    for (let k = -smooth; k <= smooth; k++) {
      const j = i + k
      if (j >= 0 && j < env.length) {
        s += env[j]!
        c++
      }
    }
    return s / c
  })
  const diff: number[] = []
  for (let i = 1; i < e2.length; i++) {
    diff.push(Math.max(0, e2[i]! - e2[i - 1]!))
  }
  const sig = diff.length > 200 ? diff : e2
  const n = sig.length
  const minBpm = 96
  const maxBpm = 155
  const minLag = Math.floor((60 / maxBpm) * (sr / hop))
  const maxLag = Math.ceil((60 / minBpm) * (sr / hop))
  let bestLag = minLag
  let bestScore = -1
  for (let lag = minLag; lag < Math.min(maxLag, Math.floor(n / 2)); lag++) {
    let acc = 0
    for (let i = 0; i < n - lag; i++) acc += sig[i]! * sig[i + lag]!
    if (acc > bestScore) {
      bestScore = acc
      bestLag = lag
    }
  }
  const bpm = (60 * sr) / (hop * bestLag)
  if (!Number.isFinite(bpm) || bpm < minBpm || bpm > maxBpm) return 124
  return Math.round(bpm * 10) / 10
}

export function analyzeTrack(buffer: AudioBuffer): TrackAnalysis {
  const bpm = estimateBpm(buffer)
  const { keyLabel, camelot } = estimateKey(buffer)
  return { bpm, keyLabel, camelot }
}

/** Times (seconds) of bass/kick-ish envelope peaks for visual sync / nudge hints. */
export function computeKickMarkers(buffer: AudioBuffer, maxOut = 500): number[] {
  const ch0 = buffer.getChannelData(0)
  const n = ch0.length
  const sr = buffer.sampleRate
  const hop = Math.max(256, Math.floor(sr * 0.018))
  let env = 0
  const envArr: number[] = []
  for (let i = 0; i < n; i += hop) {
    let m = 0
    const end = Math.min(n, i + hop)
    for (let j = i; j < end; j++) {
      const v = Math.abs(ch0[j]!)
      if (v > m) m = v
    }
    env += 0.055 * (m - env)
    envArr.push(env)
  }
  const peak = Math.max(...envArr, 1e-8)
  const thresh = peak * 0.22
  const raw: number[] = []
  for (let i = 2; i < envArr.length - 2; i++) {
    const e = envArr[i]!
    if (e < thresh) continue
    if (e > envArr[i - 1]! && e >= envArr[i + 1]!) {
      const tSec = (i * hop) / sr
      if (tSec > 0.08 && tSec < buffer.duration - 0.08) raw.push(tSec)
    }
  }
  const dedup: number[] = []
  for (const t of raw.sort((a, b) => a - b)) {
    if (dedup.length === 0 || t - dedup[dedup.length - 1]! > 0.07) dedup.push(t)
    if (dedup.length >= maxOut) break
  }
  return dedup
}

/**
 * Seconds to nudge the **follower** deck so “time until next kick” matches the **master**
 * (same upcoming-downbeat alignment). Pass master’s playhead/kicks first, follower’s second.
 */
export function kickAlignNudgeSec(
  curMaster: number,
  curFollower: number,
  kicksMaster: readonly number[],
  kicksFollower: readonly number[],
): number | null {
  if (kicksMaster.length < 3 || kicksFollower.length < 3) return null
  const nextM = kicksMaster.find((t) => t > curMaster + 0.05)
  const nextF = kicksFollower.find((t) => t > curFollower + 0.05)
  if (nextM == null || nextF == null) return null
  const untilM = nextM - curMaster
  const untilF = nextF - curFollower
  const delta = untilF - untilM
  if (!Number.isFinite(delta) || Math.abs(delta) > 0.42) return null
  return delta
}
