import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const TASKS_VERSION = '0.10.21'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const WRIST = 0
const THUMB = 4
const INDEX = 8
const MIDDLE = 12
const RING = 16
const PINKY = 20

const TOUCH = 0.068
const TI_EXCLUSIVE = 0.082

/** After this hold, vertical slide adjusts EQ (transport taps stay short). */
const EQ_ARM_MS = 220
/** dB per normalized wrist-y unit (screen up = boost; y grows downward in landmarks). */
const EQ_VERTICAL_SENS = 52

/** Wrist x delta → temporary jog multiplier (vinyl-style; does not change stored tempo). */
const JOG_DX_SENS = 2.4

/**
 * 2D normalized distance between fingertips is often **much larger** than real contact
 * (depth separation, lens). Use loose “near” + **hold** (dwell), not a tight edge.
 */
const INDEX_TIP_NEAR = 0.145
const INDEX_TIP_RESET_FAR = 0.2
const INDEX_TIP_DWELL_MS = 260

/** Middle tips: slightly stricter so it doesn’t steal index-tempo by accident */
const MIDDLE_TIP_NEAR = 0.12
const MIDDLE_TIP_RESET_FAR = 0.2
const MIDDLE_TIP_DWELL_MS = 260

const TEMPO_MATCH_COOLDOWN_MS = 900
const PHASE_ALIGN_COOLDOWN_MS = 900

let landmarker: HandLandmarker | null = null
let landmarkerPromise: Promise<HandLandmarker> | null = null

export async function ensureHandLandmarker(): Promise<HandLandmarker> {
  if (landmarker) return landmarker
  if (landmarkerPromise) return landmarkerPromise

  landmarkerPromise = (async () => {
    const wasm = await FilesetResolver.forVisionTasks(WASM_URL)
    const tryCreate = (delegate: 'CPU' | 'GPU') =>
      HandLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      })
    try {
      return await tryCreate('GPU')
    } catch {
      return await tryCreate('CPU')
    }
  })()

  try {
    landmarker = await landmarkerPromise
    return landmarker
  } catch (e) {
    landmarker = null
    throw e
  } finally {
    landmarkerPromise = null
  }
}

export function disposeHandLandmarker(): void {
  landmarker?.close()
  landmarker = null
  landmarkerPromise = null
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function touchThumbFinger(lm: NormalizedLandmark[], finger: number): boolean {
  return dist(lm[THUMB]!, lm[finger]!) < TOUCH
}

function touchingTM(lm: NormalizedLandmark[]): boolean {
  return touchThumbFinger(lm, MIDDLE)
}

/** Thumb–index (pointer on thumb, middle clearly off) — double-tap play/pause, or volume after hold + wrist up/down. */
function tiCueChord(lm: NormalizedLandmark[]): boolean {
  return dist(lm[THUMB]!, lm[INDEX]!) < TOUCH && dist(lm[THUMB]!, lm[MIDDLE]!) > TI_EXCLUSIVE
}

function fullPinch(lm: NormalizedLandmark[]): boolean {
  return (
    touchThumbFinger(lm, INDEX) &&
    touchThumbFinger(lm, MIDDLE) &&
    touchThumbFinger(lm, RING) &&
    touchThumbFinger(lm, PINKY)
  )
}

/** Index/middle/ring/pinky tips extended downward (screen-down), not curled under. */
function fingersPointedDown(lm: NormalizedLandmark[]): boolean {
  const tipBelow = (tip: number, pip: number) => lm[tip]!.y > lm[pip]!.y + 0.018
  return (
    tipBelow(INDEX, 6) &&
    tipBelow(MIDDLE, 10) &&
    tipBelow(RING, 14) &&
    tipBelow(PINKY, 18)
  )
}

/** High EQ: thumb–middle (index away from thumb so it doesn’t read as TI). */
function thumbMiddleHighChord(lm: NormalizedLandmark[]): boolean {
  return touchingTM(lm) && dist(lm[THUMB]!, lm[INDEX]!) >= TI_EXCLUSIVE * 0.98
}

/** Mid EQ: thumb–ring only (pinky / index / middle off thumb). */
function thumbRingMidChord(lm: NormalizedLandmark[]): boolean {
  return (
    touchThumbFinger(lm, RING) &&
    !touchThumbFinger(lm, PINKY) &&
    !touchThumbFinger(lm, INDEX) &&
    !touchThumbFinger(lm, MIDDLE)
  )
}

function thumbPinkyLowChord(lm: NormalizedLandmark[]): boolean {
  return (
    touchThumbFinger(lm, PINKY) &&
    !touchThumbFinger(lm, RING) &&
    !touchThumbFinger(lm, INDEX) &&
    !touchThumbFinger(lm, MIDDLE)
  )
}

type HandLabel = 'Left' | 'Right'

function handsByLabel(
  landmarks: NormalizedLandmark[][],
  handedness: { categoryName: string }[][],
): Partial<Record<HandLabel, NormalizedLandmark[]>> {
  const out: Partial<Record<HandLabel, NormalizedLandmark[]>> = {}
  for (let i = 0; i < landmarks.length; i++) {
    const name = handedness[i]?.[0]?.categoryName
    if (name === 'Left' || name === 'Right') {
      out[name] = landmarks[i]!
    }
  }
  return out
}

export type DeckHudSnapshot = {
  deckLine: string
  title: string
  bpmLine: string
  keyLine: string
  elapsed: string
  remaining: string
  /** 0…1 for rotating playhead needle */
  progress: number
  /** 0…1 beat phase from analyzed BPM × playback rate */
  beatPhase01: number
  /** Playback multiplier for small readout */
  playbackRate: number
  /** e.g. "1.000×" or "1.024× varispeed" */
  tempoKeyLine: string
}

export type HandGestureCallbacks = {
  setCrossfader: (t: number) => void
  setChannelVolume: (deck: 'A' | 'B', t: number) => void
  toggleTransport: (deck: 'A' | 'B') => void | Promise<void>
  getCrossfader: () => number
  getChannelVolume: (deck: 'A' | 'B') => number
  getEq: (deck: 'A' | 'B', band: 'low' | 'mid' | 'high') => number
  setEq: (deck: 'A' | 'B', band: 'low' | 'mid' | 'high', db: number) => void
  getDeckHud: (deck: 'A' | 'B') => DeckHudSnapshot
  /** Both index fingertips touch → tempo match (playback rates from BPM estimates) */
  onTempoMatch?: () => void
  /** Both middle fingertips touch → nudge follower deck phase to match the playing reference */
  onPhaseAlign?: () => void
  isDeckPlaying?: (deck: 'A' | 'B') => boolean
  /** Temporary rate nudge while gesture is active (see `setJogTempo` / deck jog multiplier). */
  setJogTempo?: (deck: 'A' | 'B', mult: number) => void
  resetJogTempo?: (deck: 'A' | 'B') => void
}

export type HandGestureLoopOptions = {
  video: HTMLVideoElement
  overlay: HTMLCanvasElement
  crossfader: HTMLInputElement
  volA: HTMLInputElement
  volB: HTMLInputElement
  eqInputs: {
    A: { low: HTMLInputElement; mid: HTMLInputElement; high: HTMLInputElement }
    B: { low: HTMLInputElement; mid: HTMLInputElement; high: HTMLInputElement }
  }
  callbacks: HandGestureCallbacks
}

type EqBand = 'low' | 'mid' | 'high'

type ActiveEqKnob = {
  band: EqBand
  /** Normalized wrist y when vertical slide arms. */
  anchorYN: number
  baseDb: number
  /** True after EQ_ARM_MS so short taps still count for transport. */
  armed: boolean
  chordSince: number
}

type JogGesture = {
  anchorX: number
}

type TiTransport = {
  downAt: number | null
  prevChord: boolean
  lastShortReleaseAt: number | null
  /** True once TI chord has armed vertical volume (suppresses transport double-tap). */
  volLatch: boolean
}

type TiVolArm = {
  anchorY: number
  baseVol: number
  armed: boolean
  since: number
}

const DOUBLE_TI_MS = 380
const TI_TAP_MIN_MS = 28
const TI_TAP_MAX_MS = 260
const TOGGLE_COOLDOWN_MS = 450
const VOL_SENS = 2.2

let rafId = 0
let active = false
let loopOpts: HandGestureLoopOptions | null = null

const tiTransByHand: Partial<Record<HandLabel, TiTransport>> = {}
const eqKnobByHand: Partial<Record<HandLabel, ActiveEqKnob | null>> = {}
const tiVolByHand: Partial<Record<HandLabel, TiVolArm | null>> = {}
const jogByHand: Partial<Record<HandLabel, JogGesture | null>> = {}

let lastToggleAt = 0

let indexTipDwellStart: number | null = null
let middleTipDwellStart: number | null = null
let lastTempoMatchAt = 0
let lastPhaseAlignAt = 0

function deckForHand(h: HandLabel): 'A' | 'B' {
  return h === 'Left' ? 'A' : 'B'
}

function getTiTrans(h: HandLabel): TiTransport {
  let t = tiTransByHand[h]
  if (!t) {
    t = {
      downAt: null,
      prevChord: false,
      lastShortReleaseAt: null,
      volLatch: false,
    }
    tiTransByHand[h] = t
  }
  return t
}

/** Normalized landmark → overlay pixels (matches mirrored video preview). */
function scr(p: NormalizedLandmark, cw: number, ch: number): { x: number; y: number } {
  return { x: (1 - p.x) * cw, y: p.y * ch }
}

function clampDb(db: number): number {
  return Math.max(-12, Math.min(12, db))
}

function resetAllGestureState(): void {
  delete tiTransByHand.Left
  delete tiTransByHand.Right
  eqKnobByHand.Left = null
  eqKnobByHand.Right = null
  tiVolByHand.Left = null
  tiVolByHand.Right = null
  jogByHand.Left = null
  jogByHand.Right = null
  indexTipDwellStart = null
  middleTipDwellStart = null
  lastTempoMatchAt = 0
  lastPhaseAlignAt = 0
}

function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  lm: NormalizedLandmark[] | undefined,
  lineRgba: string,
  jointRgba: string,
): void {
  if (!lm) return

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2.5
  ctx.strokeStyle = lineRgba

  for (const c of HandLandmarker.HAND_CONNECTIONS) {
    const a = lm[c.start]
    const b = lm[c.end]
    if (!a || !b) continue
    const pa = scr(a, cw, ch)
    const pb = scr(b, cw, ch)
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
  }

  for (let i = 0; i < lm.length; i++) {
    const p = lm[i]!
    const o = scr(p, cw, ch)
    const tip = i === THUMB || i === INDEX || i === MIDDLE || i === RING || i === PINKY
    const r = tip ? 4.5 : 3
    ctx.beginPath()
    ctx.arc(o.x, o.y, r, 0, Math.PI * 2)
    ctx.fillStyle = jointRgba
    ctx.fill()
    ctx.strokeStyle = lineRgba
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
  ctx.restore()
}

/** Compact “on-jog” style readout anchored near the wrist. */
function drawJogHud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  snap: DeckHudSnapshot,
  accent: string,
  secondary: string,
): void {
  const r = 78
  ctx.save()
  ctx.translate(cx, cy)

  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(6,0,0,0.78)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,60,60,0.35)'
  ctx.lineWidth = 2
  ctx.stroke()

  const prog = Math.max(0, Math.min(1, snap.progress))
  ctx.beginPath()
  ctx.arc(0, 0, r - 5, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2)
  ctx.strokeStyle = accent
  ctx.lineWidth = 3
  ctx.stroke()

  const needleA = -Math.PI / 2 + prog * Math.PI * 2
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(Math.cos(needleA) * (r - 10), Math.sin(needleA) * (r - 10))
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
  ctx.lineWidth = 2.2
  ctx.stroke()

  const beatA = -Math.PI / 2 + snap.beatPhase01 * Math.PI * 2
  const br = r - 22
  ctx.beginPath()
  ctx.arc(Math.cos(beatA) * br, Math.sin(beatA) * br, 4.5, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.rotate(-Math.PI / 2.15)
  ctx.font = '600 9px "IBM Plex Serif", Georgia, serif'
  ctx.fillStyle = secondary
  ctx.textAlign = 'center'
  ctx.fillText(snap.deckLine, 0, -r + 14)
  ctx.rotate(Math.PI / 2.15)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#f8fafc'
  ctx.font = '700 20px "JetBrains Mono", ui-monospace, monospace'
  ctx.fillText(snap.bpmLine, 0, -8)
  ctx.font = '10px "JetBrains Mono", ui-monospace, monospace'
  ctx.fillStyle = secondary
  ctx.fillText(`${snap.keyLine} · ${snap.tempoKeyLine}`, 0, 10)

  ctx.fillStyle = '#e5e7eb'
  ctx.font = '600 11px ui-monospace,monospace,sans-serif'
  ctx.fillText(snap.elapsed, 0, 28)
  ctx.fillStyle = 'rgba(248,250,252,0.75)'
  ctx.font = '600 10px ui-monospace,monospace,sans-serif'
  ctx.fillText(snap.remaining, 0, 44)

  const shortTitle =
    snap.title.length > 22 ? `${snap.title.slice(0, 20)}…` : snap.title
  ctx.fillStyle = 'rgba(226,232,240,0.88)'
  ctx.font = '9px "JetBrains Mono", ui-monospace, monospace'
  ctx.fillText(shortTitle, 0, r - 12)

  ctx.restore()
}

function updateEqSliderUi(deck: 'A' | 'B', band: EqBand, db: number): void {
  if (!loopOpts) return
  const inputs = loopOpts.eqInputs[deck]
  const el = band === 'low' ? inputs.low : band === 'mid' ? inputs.mid : inputs.high
  el.value = String(db)
}

function frame(): void {
  if (!active || !loopOpts) return
  const { video, overlay, volA, volB, callbacks } = loopOpts

  if (video.readyState < 2 || !video.videoWidth) {
    rafId = requestAnimationFrame(frame)
    return
  }

  const lmInst = landmarker
  if (!lmInst) {
    rafId = requestAnimationFrame(frame)
    return
  }

  const res = lmInst.detectForVideo(video, performance.now())
  const hands = handsByLabel(res.landmarks, res.handedness)
  const now = performance.now()

  for (const h of ['Left', 'Right'] as HandLabel[]) {
    const labelLm = hands[h]
    if (!labelLm) continue

    if (fullPinch(labelLm)) {
      eqKnobByHand[h] = null
      tiVolByHand[h] = null
      const tt = getTiTrans(h)
      tt.prevChord = false
      tt.downAt = null
      continue
    }

    const deck = deckForHand(h)
    const tt = getTiTrans(h)

    const wrist = labelLm[WRIST]!
    const wristY = wrist.y
    const processEqSlideChord = (chordActive: boolean, band: EqBand): void => {
      if (!chordActive) {
        if (eqKnobByHand[h]?.band === band) eqKnobByHand[h] = null
        return
      }

      let st = eqKnobByHand[h]
      if (!st || st.band !== band) {
        eqKnobByHand[h] = {
          band,
          anchorYN: wristY,
          baseDb: callbacks.getEq(deck, band),
          armed: false,
          chordSince: now,
        }
        st = eqKnobByHand[h]!
      }

      if (!st.armed && now - st.chordSince >= EQ_ARM_MS) {
        st.armed = true
        st.anchorYN = wristY
        st.baseDb = callbacks.getEq(deck, band)
      }

      if (st.armed) {
        // Screen up (smaller y) → more boost, same convention as volume.
        const next = clampDb(st.baseDb - (wristY - st.anchorYN) * EQ_VERTICAL_SENS)
        callbacks.setEq(deck, band, next)
        updateEqSliderUi(deck, band, next)
      }
    }

    processEqSlideChord(thumbPinkyLowChord(labelLm), 'low')
    processEqSlideChord(thumbRingMidChord(labelLm), 'mid')
    processEqSlideChord(thumbMiddleHighChord(labelLm), 'high')

    const tiChord = tiCueChord(labelLm)

    if (tiChord) {
      let vs = tiVolByHand[h]
      if (!vs) {
        tiVolByHand[h] = {
          anchorY: wristY,
          baseVol: callbacks.getChannelVolume(deck),
          armed: false,
          since: now,
        }
        vs = tiVolByHand[h]!
      }
      if (!vs.armed && now - vs.since >= EQ_ARM_MS) {
        vs.armed = true
        vs.anchorY = wristY
        vs.baseVol = callbacks.getChannelVolume(deck)
        tt.volLatch = true
      }
      if (vs.armed) {
        const next = Math.max(0, Math.min(1, vs.baseVol - (wristY - vs.anchorY) * VOL_SENS))
        callbacks.setChannelVolume(deck, next)
        if (deck === 'A') volA.value = String(Math.round(next * 100))
        else volB.value = String(Math.round(next * 100))
      }
    } else {
      tiVolByHand[h] = null
    }

    const vinylJogChord =
      fingersPointedDown(labelLm) &&
      !thumbMiddleHighChord(labelLm) &&
      !tiChord &&
      !thumbRingMidChord(labelLm) &&
      !thumbPinkyLowChord(labelLm)

    if (vinylJogChord && callbacks.setJogTempo && callbacks.resetJogTempo && callbacks.isDeckPlaying) {
      if (callbacks.isDeckPlaying(deck)) {
        let jg = jogByHand[h]
        if (!jg) {
          jogByHand[h] = { anchorX: wrist.x }
          jg = jogByHand[h]!
        }
        const dx = wrist.x - jg.anchorX
        const mult = Math.max(0.92, Math.min(1.08, 1 + dx * JOG_DX_SENS))
        callbacks.setJogTempo(deck, mult)
      } else {
        if (jogByHand[h]) {
          callbacks.resetJogTempo(deck)
          jogByHand[h] = null
        }
      }
    } else {
      if (jogByHand[h] && callbacks.resetJogTempo) {
        callbacks.resetJogTempo(deck)
        jogByHand[h] = null
      }
    }

    if (tiChord && !tt.prevChord) {
      tt.downAt = now
      tt.volLatch = false
    }
    if (!tiChord && tt.prevChord && tt.downAt != null) {
      const dur = now - tt.downAt
      tt.downAt = null
      if (!tt.volLatch && dur >= TI_TAP_MIN_MS && dur <= TI_TAP_MAX_MS) {
        const lr = tt.lastShortReleaseAt
        if (lr != null && now - lr <= DOUBLE_TI_MS && now - lastToggleAt >= TOGGLE_COOLDOWN_MS) {
          void callbacks.toggleTransport(deck)
          lastToggleAt = now
          tt.lastShortReleaseAt = null
        } else {
          tt.lastShortReleaseAt = now
        }
      }
      if (tt.volLatch) {
        tt.lastShortReleaseAt = null
      }
      tt.volLatch = false
    }
    tt.prevChord = tiChord
  }

  const leftLm = hands.Left
  const rightLm = hands.Right
  if (leftLm && rightLm) {
    const idxSep = dist(leftLm[INDEX]!, rightLm[INDEX]!)
    const midSep = dist(leftLm[MIDDLE]!, rightLm[MIDDLE]!)
    const { onPhaseAlign, onTempoMatch } = loopOpts.callbacks

    let twoHandConsumed = false

    if (onPhaseAlign) {
      if (midSep < MIDDLE_TIP_NEAR) {
        if (middleTipDwellStart == null) middleTipDwellStart = now
        else if (
          now - middleTipDwellStart >= MIDDLE_TIP_DWELL_MS &&
          now - lastPhaseAlignAt >= PHASE_ALIGN_COOLDOWN_MS
        ) {
          onPhaseAlign()
          lastPhaseAlignAt = now
          middleTipDwellStart = null
          indexTipDwellStart = null
          twoHandConsumed = true
        }
      } else if (midSep > MIDDLE_TIP_RESET_FAR) {
        middleTipDwellStart = null
      }
    } else {
      middleTipDwellStart = null
    }

    if (!twoHandConsumed && onTempoMatch) {
      if (idxSep < INDEX_TIP_NEAR) {
        if (indexTipDwellStart == null) indexTipDwellStart = now
        else if (
          now - indexTipDwellStart >= INDEX_TIP_DWELL_MS &&
          now - lastTempoMatchAt >= TEMPO_MATCH_COOLDOWN_MS
        ) {
          onTempoMatch()
          lastTempoMatchAt = now
          indexTipDwellStart = null
          middleTipDwellStart = null
        }
      } else if (idxSep > INDEX_TIP_RESET_FAR) {
        indexTipDwellStart = null
      }
    } else if (!onTempoMatch) {
      indexTipDwellStart = null
    }
  } else {
    indexTipDwellStart = null
    middleTipDwellStart = null
  }

  const ctxOv = overlay.getContext('2d')
  const w = overlay.clientWidth
  const h = overlay.clientHeight
  if (ctxOv && w > 2 && h > 2) {
    const dpr = window.devicePixelRatio || 1
    overlay.width = Math.floor(w * dpr)
    overlay.height = Math.floor(h * dpr)
    ctxOv.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctxOv.clearRect(0, 0, w, h)
    drawHandOverlay(
      ctxOv,
      w,
      h,
      hands.Left,
      'rgba(255,60,60,0.95)',
      'rgba(255,240,240,0.95)',
    )
    drawHandOverlay(
      ctxOv,
      w,
      h,
      hands.Right,
      'rgba(57,255,106,0.92)',
      'rgba(220,255,230,0.95)',
    )

    const wristLm = (lm: NormalizedLandmark[] | undefined) => lm?.[WRIST]
    const wl = wristLm(hands.Left)
    const wr = wristLm(hands.Right)
    if (wl) {
      const p = scr(wl, w, h)
      drawJogHud(ctxOv, p.x, p.y - 96, loopOpts.callbacks.getDeckHud('A'), '#ff2a2a', 'rgba(255, 220, 220, 0.88)')
    }
    if (wr) {
      const p = scr(wr, w, h)
      drawJogHud(ctxOv, p.x, p.y - 96, loopOpts.callbacks.getDeckHud('B'), '#39ff6a', 'rgba(210, 255, 225, 0.88)')
    }

  }

  rafId = requestAnimationFrame(frame)
}

export async function startHandGestureLoop(
  opts: HandGestureLoopOptions,
  shouldRun: () => boolean,
): Promise<void> {
  await ensureHandLandmarker()
  if (!shouldRun()) return
  stopHandGestureLoop()
  loopOpts = opts
  active = true
  resetAllGestureState()
  rafId = requestAnimationFrame(frame)
}

export function stopHandGestureLoop(): void {
  active = false
  cancelAnimationFrame(rafId)
  rafId = 0
  if (loopOpts?.overlay) {
    const o = loopOpts.overlay
    const ctx = o.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, o.width, o.height)
  }
  loopOpts = null
  resetAllGestureState()
}
