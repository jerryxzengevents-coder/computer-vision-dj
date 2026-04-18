import './style.css'
import {
  analyzeTrack,
  beatPhase01,
  beatPhaseNudgeSec,
  computeKickMarkers,
  kickAlignNudgeSec,
  type TrackAnalysis,
} from './analysis.ts'
import { Deck } from './deck.ts'
import {
  disposeHandLandmarker,
  startHandGestureLoop,
  stopHandGestureLoop,
  type HandGestureLoopOptions,
} from './handGestures.ts'
import { createMixer } from './mixer.ts'
import { startReactiveViz, type VizUiSnapshot } from './reactiveViz.ts'
import {
  computePeaks,
  computeSignedMinMaxBins,
  computeTriBandPeaks,
  drawWaveformWindowed,
  type SignedMmBins,
  type TriBandPeaks,
} from './waveform.ts'
import { startWebcamPreview, stopWebcamPreview } from './webcam.ts'

const WAVEFORM_BINS = 1600
/** CSS pixel height for beat-grid zoom waveforms (top of performance panel). */
const ZOOM_WAVE_CSS_H = 132

/** Visible time span (seconds) for zoom waveforms; wheel adjusts per deck. */
const ZOOM_WINDOW_MIN = 4
const ZOOM_WINDOW_MAX = 48
const zoomWindowSecByDeck = { A: 10, B: 10 }

function zoomTimeWindow(deck: Deck, key: 'A' | 'B'): { t0: number; t1: number } {
  const dur = deck.duration
  const cur = deck.getCurrentTime()
  const win = zoomWindowSecByDeck[key]
  if (!Number.isFinite(dur) || dur <= 0) return { t0: 0, t1: 1 }
  const half = win / 2
  let t0 = cur - half
  let t1 = cur + half
  if (t0 < 0) {
    t0 = 0
    t1 = Math.min(dur, win)
  }
  if (t1 > dur) {
    t1 = dur
    t0 = Math.max(0, dur - win)
  }
  if (t1 <= t0) t1 = Math.min(dur, t0 + 0.001)
  return { t0, t1 }
}

const mixer = createMixer()
const deckA = new Deck(mixer.context, mixer.channelGainA)
const deckB = new Deck(mixer.context, mixer.channelGainB)

const vizCanvas = document.querySelector<HTMLCanvasElement>('#reactive-viz')!

const playIcon = `<svg class="transport-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`
const pauseIcon = `<svg class="transport-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>`

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header class="top">
    <h1 class="site-title" aria-label="Computer Vision DJ">
      <span class="site-title__primary">CVISION_DJ</span>
      <span class="site-title__ver" aria-hidden="true">// 0x01</span>
    </h1>
    <p class="sub">Waveforms, camera gestures, and tempo / phase tools.</p>
  </header>

  <section class="panel camera-block">
    <div class="camera-toolbar">
      <p id="sync-status" class="sync-status" role="status" aria-live="polite"></p>
      <span id="hand-status" class="hand-status" hidden>Loading hand model…</span>
      <div class="camera-toolbar__actions">
        <label class="hand-toggle cam-toolbar-toggle" title="Fullscreen strobes and lasers; uses more GPU when enabled">
          <input id="reactive-lights-toggle" type="checkbox" />
          <span>Lights</span>
        </label>
        <button id="cam-toggle" class="btn secondary btn-sm" type="button">Start camera</button>
      </div>
    </div>
    <div class="video-shell">
      <video id="cam-preview" class="cam-preview" playsinline muted></video>
      <canvas id="hand-overlay" class="hand-overlay" aria-hidden="true"></canvas>
      <aside class="cam-gesture-panel" id="cam-gesture-panel" aria-label="Hand gesture cheat sheet">
        <div class="cam-gesture-panel__inner">
          <div class="cam-gesture-panel__head">
            <div class="cam-gesture-panel__titles">
              <p class="cam-gesture-eyebrow">Hand controls</p>
              <h3 class="cam-gesture-title">Cheat sheet</h3>
            </div>
            <button
              type="button"
              id="cam-gesture-minimize"
              class="cam-gesture-minimize-btn"
              aria-expanded="true"
              aria-controls="cam-gesture-sheet-body"
            >
              Hide
            </button>
          </div>
          <div id="cam-gesture-sheet-body" class="cam-gesture-sheet-body">
          <p class="cam-gesture-lead">Each gesture applies to that side’s deck while the <strong>camera</strong> is on.</p>

          <section class="cam-gesture-section" aria-label="Deck assignment">
            <h4 class="cam-gesture-h">Which hand</h4>
            <ul class="cam-gesture-list cam-gesture-list--compact">
              <li><span class="cam-gesture-formula">Left hand</span> <span class="cam-gesture-arrow">→</span> <span class="cam-gesture-out">Deck A</span></li>
              <li><span class="cam-gesture-formula">Right hand</span> <span class="cam-gesture-arrow">→</span> <span class="cam-gesture-out">Deck B</span></li>
            </ul>
          </section>

          <section class="cam-gesture-section" aria-label="EQ gestures">
            <h4 class="cam-gesture-h">EQ bands</h4>
            <p class="cam-gesture-step">Hold the chord ~0.2s, then <strong>wrist up / down</strong> to ride the knob.</p>
            <ul class="cam-gesture-list">
              <li><span class="cam-gesture-formula">Thumb + pinky</span> <span class="cam-gesture-arrow">→</span> <span class="cam-gesture-out">Low EQ</span></li>
              <li><span class="cam-gesture-formula">Thumb + ring</span> <span class="cam-gesture-arrow">→</span> <span class="cam-gesture-out">Mid EQ</span></li>
              <li><span class="cam-gesture-formula">Thumb + middle</span> <span class="cam-gesture-arrow">→</span> <span class="cam-gesture-out">High EQ</span> <span class="cam-gesture-fine">(keep index away from thumb)</span></li>
            </ul>
          </section>

          <section class="cam-gesture-section" aria-label="Volume and transport">
            <h4 class="cam-gesture-h">Volume &amp; play</h4>
            <p class="cam-gesture-step"><span class="cam-gesture-formula">Thumb + index</span> — hold, then wrist <strong>up / down</strong> for channel volume. <strong>Quick double-tap</strong> = play / pause.</p>
          </section>

          <section class="cam-gesture-section" aria-label="Jog tempo">
            <h4 class="cam-gesture-h">Vinyl jog</h4>
            <p class="cam-gesture-step">While that deck is <strong>playing</strong>: four fingers pointing <strong>down</strong>, move wrist <strong>left</strong> (slow) or <strong>right</strong> (fast) for a temporary tempo nudge.</p>
          </section>

          <section class="cam-gesture-section" aria-label="Two-hand sync">
            <h4 class="cam-gesture-h">Both hands</h4>
            <ul class="cam-gesture-list">
              <li><span class="cam-gesture-formula">Index tips together</span> <span class="cam-gesture-arrow">→</span> <span class="cam-gesture-out">Tempo match + auto phase</span></li>
              <li><span class="cam-gesture-formula">Middle tips together</span> <span class="cam-gesture-arrow">→</span> <span class="cam-gesture-out">Phase align only</span></li>
            </ul>
          </section>

          <p class="cam-gesture-foot">Pinch <strong>all</strong> fingertips to thumb to release a chord. Crossfader stays on the slider under the decks.</p>
          </div>
        </div>
      </aside>
    </div>
  </section>

  <section class="panel panel--performance" id="performance-panel">
    <div class="rb-zoom-dual" aria-label="Zoomed waveforms with beat grid">
      <div class="rb-zoom-row rb-zoom-row--a">
        <span class="rb-zoom-deck-tag" aria-hidden="true">A</span>
        <div class="wave-wrap deck-wave rb-zoom-wave" data-zoom-deck="a">
          <canvas id="wave-a" aria-label="Deck A zoomed waveform: drag to scrub, wheel to zoom window"></canvas>
        </div>
      </div>
      <div class="rb-zoom-row rb-zoom-row--b">
        <span class="rb-zoom-deck-tag" aria-hidden="true">B</span>
        <div class="wave-wrap deck-wave rb-zoom-wave rb-zoom-wave--b" data-zoom-deck="b">
          <canvas id="wave-b" aria-label="Deck B zoomed waveform: drag to scrub, wheel to zoom window"></canvas>
        </div>
      </div>
    </div>

    <div class="mixer-row rb-toolbar">
      <button id="align-phase" class="btn secondary btn-sm rb-align-btn" type="button">
        Align phase
      </button>
    </div>

    <div class="decks">
      <div class="deck deck-a">
        <div class="deck-head">
          <span class="deck-tag">Deck A</span>
          <label class="file-label">
            <input id="file-a" type="file" accept="audio/*" hidden />
            <span class="btn secondary btn-sm">Load</span>
          </label>
        </div>
        <p id="name-a" class="deck-name">No track</p>
        <p id="meta-a" class="deck-meta">BPM — · Key —</p>
        <div class="phase-row" aria-label="Beat phase from analyzed BPM">
          <div id="phase-ring-a" class="phase-ring" role="img"></div>
          <span id="phase-txt-a" class="phase-txt">φ —</span>
          <span id="rate-txt-a" class="rate-txt">1.000×</span>
        </div>
        <div class="deck-eq-vol" aria-label="Deck A EQ and volume">
          <div class="eq-strip eq-strip--v" aria-label="Deck A EQ">
            <label class="eq-label-v">Low
              <input id="eq-a-low" class="eq-slider eq-slider--v" type="range" min="-12" max="12" value="0" step="0.5" />
            </label>
            <label class="eq-label-v">Mid
              <input id="eq-a-mid" class="eq-slider eq-slider--v" type="range" min="-12" max="12" value="0" step="0.5" />
            </label>
            <label class="eq-label-v">High
              <input id="eq-a-high" class="eq-slider eq-slider--v" type="range" min="-12" max="12" value="0" step="0.5" />
            </label>
          </div>
          <div class="deck-vol">
            <span class="deck-vol-label">Vol</span>
            <input id="vol-a" class="vol-slider vol-slider--v" type="range" min="0" max="100" value="100" aria-label="Deck A volume" />
          </div>
        </div>
        <div class="row transport">
          <button id="transport-a" class="btn transport-btn" type="button" disabled aria-pressed="false" aria-label="Play">
            <span class="transport-icon" data-mode="play">${playIcon}</span>
            <span class="transport-icon" data-mode="pause" hidden>${pauseIcon}</span>
          </button>
          <span id="time-a" class="time">0:00 / 0:00</span>
        </div>
      </div>

      <div class="deck deck-b">
        <div class="deck-head">
          <span class="deck-tag deck-tag-b">Deck B</span>
          <label class="file-label">
            <input id="file-b" type="file" accept="audio/*" hidden />
            <span class="btn secondary btn-sm">Load</span>
          </label>
        </div>
        <p id="name-b" class="deck-name">No track</p>
        <p id="meta-b" class="deck-meta">BPM — · Key —</p>
        <div class="phase-row" aria-label="Beat phase from analyzed BPM">
          <div id="phase-ring-b" class="phase-ring phase-ring-b" role="img"></div>
          <span id="phase-txt-b" class="phase-txt">φ —</span>
          <span id="rate-txt-b" class="rate-txt">1.000×</span>
        </div>
        <div class="deck-eq-vol" aria-label="Deck B EQ and volume">
          <div class="eq-strip eq-strip--v" aria-label="Deck B EQ">
            <label class="eq-label-v">Low
              <input id="eq-b-low" class="eq-slider eq-slider--v" type="range" min="-12" max="12" value="0" step="0.5" />
            </label>
            <label class="eq-label-v">Mid
              <input id="eq-b-mid" class="eq-slider eq-slider--v" type="range" min="-12" max="12" value="0" step="0.5" />
            </label>
            <label class="eq-label-v">High
              <input id="eq-b-high" class="eq-slider eq-slider--v" type="range" min="-12" max="12" value="0" step="0.5" />
            </label>
          </div>
          <div class="deck-vol">
            <span class="deck-vol-label">Vol</span>
            <input id="vol-b" class="vol-slider vol-slider--v" type="range" min="0" max="100" value="100" aria-label="Deck B volume" />
          </div>
        </div>
        <div class="row transport">
          <button id="transport-b" class="btn transport-btn" type="button" disabled aria-pressed="false" aria-label="Play">
            <span class="transport-icon" data-mode="play">${playIcon}</span>
            <span class="transport-icon" data-mode="pause" hidden>${pauseIcon}</span>
          </button>
          <span id="time-b" class="time">0:00 / 0:00</span>
        </div>
      </div>
    </div>

    <details class="rb-xf-details">
      <summary class="rb-xf-summary">Crossfader <span class="rb-xf-hint">(mouse only)</span></summary>
      <div class="cross-row rb-cross-row">
        <span class="xf-label">A</span>
        <input id="crossfader" class="crossfader" type="range" min="0" max="100" value="50" aria-label="Crossfader: deck A to deck B" />
        <span class="xf-label">B</span>
      </div>
    </details>
  </section>
`

const performancePanel = document.querySelector<HTMLElement>('#performance-panel')!
const crossfader = document.querySelector<HTMLInputElement>('#crossfader')!
const volA = document.querySelector<HTMLInputElement>('#vol-a')!
const volB = document.querySelector<HTMLInputElement>('#vol-b')!
const alignPhaseBtn = document.querySelector<HTMLButtonElement>('#align-phase')!

const fileA = document.querySelector<HTMLInputElement>('#file-a')!
const fileB = document.querySelector<HTMLInputElement>('#file-b')!

const nameA = document.querySelector<HTMLParagraphElement>('#name-a')!
const nameB = document.querySelector<HTMLParagraphElement>('#name-b')!
const metaA = document.querySelector<HTMLParagraphElement>('#meta-a')!
const metaB = document.querySelector<HTMLParagraphElement>('#meta-b')!

const phaseRingA = document.querySelector<HTMLDivElement>('#phase-ring-a')!
const phaseTxtA = document.querySelector<HTMLSpanElement>('#phase-txt-a')!
const rateTxtA = document.querySelector<HTMLSpanElement>('#rate-txt-a')!
const phaseRingB = document.querySelector<HTMLDivElement>('#phase-ring-b')!
const phaseTxtB = document.querySelector<HTMLSpanElement>('#phase-txt-b')!
const rateTxtB = document.querySelector<HTMLSpanElement>('#rate-txt-b')!

const syncStatus = document.querySelector<HTMLParagraphElement>('#sync-status')!

const canvasA = document.querySelector<HTMLCanvasElement>('#wave-a')!
const canvasB = document.querySelector<HTMLCanvasElement>('#wave-b')!
const ctxA = canvasA.getContext('2d')!
const ctxB = canvasB.getContext('2d')!
const zoomWrapA = document.querySelector<HTMLElement>('[data-zoom-deck="a"]')!
const zoomWrapB = document.querySelector<HTMLElement>('[data-zoom-deck="b"]')!

const transportA = document.querySelector<HTMLButtonElement>('#transport-a')!
const transportB = document.querySelector<HTMLButtonElement>('#transport-b')!
const timeA = document.querySelector<HTMLSpanElement>('#time-a')!
const timeB = document.querySelector<HTMLSpanElement>('#time-b')!

const eqALow = document.querySelector<HTMLInputElement>('#eq-a-low')!
const eqAMid = document.querySelector<HTMLInputElement>('#eq-a-mid')!
const eqAHigh = document.querySelector<HTMLInputElement>('#eq-a-high')!
const eqBLow = document.querySelector<HTMLInputElement>('#eq-b-low')!
const eqBMid = document.querySelector<HTMLInputElement>('#eq-b-mid')!
const eqBHigh = document.querySelector<HTMLInputElement>('#eq-b-high')!

function vizUiSnapshot(): VizUiSnapshot {
  const xf = Number(crossfader.value) / 100
  return {
    volA: Number(volA.value) / 100,
    volB: Number(volB.value) / 100,
    crossfader: xf,
    eqLow: Number(eqALow.value) * (1 - xf) + Number(eqBLow.value) * xf,
    eqMid: Number(eqAMid.value) * (1 - xf) + Number(eqBMid.value) * xf,
    eqHigh: Number(eqAHigh.value) * (1 - xf) + Number(eqBHigh.value) * xf,
  }
}

let disposeReactiveViz: (() => void) | null = null

function clearReactiveVizCanvas(): void {
  const c = vizCanvas.getContext('2d')
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  vizCanvas.width = Math.floor(window.innerWidth * dpr)
  vizCanvas.height = Math.floor(window.innerHeight * dpr)
  vizCanvas.style.width = `${window.innerWidth}px`
  vizCanvas.style.height = `${window.innerHeight}px`
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.fillStyle = '#000000'
  c.fillRect(0, 0, window.innerWidth, window.innerHeight)
}

function setReactiveLights(enabled: boolean): void {
  if (enabled) {
    if (!disposeReactiveViz) {
      disposeReactiveViz = startReactiveViz(mixer.analyser, vizCanvas, vizUiSnapshot)
    }
  } else {
    disposeReactiveViz?.()
    disposeReactiveViz = null
    clearReactiveVizCanvas()
  }
}

const reactiveLightsToggle = document.querySelector<HTMLInputElement>('#reactive-lights-toggle')!
reactiveLightsToggle.addEventListener('change', () => {
  setReactiveLights(reactiveLightsToggle.checked)
})
window.addEventListener('resize', () => {
  if (!disposeReactiveViz) clearReactiveVizCanvas()
})
clearReactiveVizCanvas()

const camVideo = document.querySelector<HTMLVideoElement>('#cam-preview')!
const camToggle = document.querySelector<HTMLButtonElement>('#cam-toggle')!
const handStatus = document.querySelector<HTMLSpanElement>('#hand-status')!
const handOverlay = document.querySelector<HTMLCanvasElement>('#hand-overlay')!
const camGesturePanel = document.querySelector<HTMLElement>('#cam-gesture-panel')!
const camGestureMinBtn = document.querySelector<HTMLButtonElement>('#cam-gesture-minimize')!

camGestureMinBtn.addEventListener('click', () => {
  const collapsed = camGesturePanel.classList.toggle('is-collapsed')
  camGestureMinBtn.textContent = collapsed ? 'Show' : 'Hide'
  camGestureMinBtn.setAttribute('aria-expanded', String(!collapsed))
})

let peaksA: number[] = []
let peaksB: number[] = []
let triMiniA: TriBandPeaks | null = null
let triMiniB: TriBandPeaks | null = null
let mmA: SignedMmBins | null = null
let mmB: SignedMmBins | null = null
let kicksA: number[] = []
let kicksB: number[] = []
let raf = 0
let cameraOn = false

let analysisA: TrackAnalysis | null = null
let analysisB: TrackAnalysis | null = null

let syncStatusClearId = 0

function showSyncStatus(message: string, ms = 4500): void {
  syncStatus.textContent = message
  window.clearTimeout(syncStatusClearId)
  syncStatusClearId = window.setTimeout(() => {
    syncStatus.textContent = ''
  }, ms)
}

/** Deck used as beat reference: sole playing deck, or crossfader side if both play, else A when paused. */
function beatSyncMaster(): 'A' | 'B' {
  const a = deckA.isPlaying
  const b = deckB.isPlaying
  if (a && !b) return 'A'
  if (b && !a) return 'B'
  if (a && b) return mixer.getCrossfader() < 0.5 ? 'A' : 'B'
  return 'A'
}

function updatePhaseAndRateUi(): void {
  const fillA = getComputedStyle(phaseRingA).getPropertyValue('--phase-fill').trim() || '#818cf8'
  const fillB = getComputedStyle(phaseRingB).getPropertyValue('--phase-fill').trim() || '#2dd4bf'

  const paint = (
    deck: Deck,
    analysis: TrackAnalysis | null,
    ring: HTMLDivElement,
    phaseEl: HTMLSpanElement,
    rateEl: HTMLSpanElement,
    fill: string,
  ): void => {
    const rate = deck.getPlaybackRate()
    rateEl.textContent = `${rate.toFixed(3)}×`
    const t = deck.getCurrentTime()
    if (analysis && analysis.bpm > 0) {
      const eff = analysis.bpm * rate
      const ph = beatPhase01(eff, t)
      ring.style.background = `conic-gradient(from -90deg, ${fill} ${ph * 360}deg, rgba(255,255,255,0.12) 0)`
      phaseEl.textContent = `${Math.round(ph * 360)}°`
    } else {
      ring.style.background =
        'conic-gradient(from -90deg, rgba(255,255,255,0.12) 0deg, rgba(255,255,255,0.12) 360deg)'
      phaseEl.textContent = 'φ —'
    }
  }

  paint(deckA, analysisA, phaseRingA, phaseTxtA, rateTxtA, fillA)
  paint(deckB, analysisB, phaseRingB, phaseTxtB, rateTxtB, fillB)

  const master = beatSyncMaster()
  const follower = master === 'A' ? 'B' : 'A'
  if (deckA.isPlaying || deckB.isPlaying) {
    alignPhaseBtn.title = `Nudge deck ${follower} to match deck ${master} (playing reference)`
  } else {
    alignPhaseBtn.title = `Nudge deck ${follower} to match deck ${master} (default reference while paused)`
  }
}

type AlignResult =
  | { ok: true; deltaMs: number; already: boolean; master: 'A' | 'B'; follower: 'A' | 'B' }
  | { ok: false; reason: string }

function alignPhaseFollowerToMaster(): AlignResult {
  const master = beatSyncMaster()
  const follower: 'A' | 'B' = master === 'A' ? 'B' : 'A'
  const deckM = master === 'A' ? deckA : deckB
  const deckF = follower === 'A' ? deckA : deckB
  const analysisM = master === 'A' ? analysisA : analysisB
  const analysisF = follower === 'A' ? analysisA : analysisB
  const kicksM = master === 'A' ? kicksA : kicksB
  const kicksF = follower === 'A' ? kicksA : kicksB

  if (deckF.duration <= 0) {
    return { ok: false, reason: `Load a track on deck ${follower}.` }
  }
  if (deckM.duration <= 0) {
    return { ok: false, reason: `Load a track on deck ${master} (reference deck).` }
  }
  if (!(analysisM?.bpm && analysisF?.bpm && analysisM.bpm > 40 && analysisF.bpm > 40)) {
    return { ok: false, reason: 'Need BPM estimates on both decks (reload tracks if missing).' }
  }
  const tM = deckM.getCurrentTime()
  const tF = deckF.getCurrentTime()
  const effF = analysisF.bpm * deckF.getPlaybackRate()
  const phM = beatPhase01(analysisM.bpm * deckM.getPlaybackRate(), tM)
  const phF = beatPhase01(effF, tF)
  const deltaBeat = beatPhaseNudgeSec(effF, phM, phF)
  const deltaKick =
    kicksM.length >= 4 && kicksF.length >= 4
      ? kickAlignNudgeSec(tM, tF, kicksM, kicksF)
      : null
  let deltaSec = deltaBeat
  const skipS = 0.0025
  if (deltaKick != null && Math.abs(deltaKick) <= 0.4) {
    if (Math.abs(deltaBeat) < skipS || Math.abs(deltaKick) < Math.abs(deltaBeat) * 1.35) {
      deltaSec = deltaKick
    }
  }
  if (Math.abs(deltaSec) < skipS) {
    return { ok: true, deltaMs: 0, already: true, master, follower }
  }
  deckF.nudgePlayhead(deltaSec)
  return { ok: true, deltaMs: deltaSec * 1000, already: false, master, follower }
}

/** Sets playback rates from BPM estimates; works while paused (applies when you hit play). */
function applyTempoMatchFromGesture(): void {
  const a = analysisA?.bpm
  const b = analysisB?.bpm
  if (!(a && b && a > 40 && a < 220 && b > 40 && b < 220)) {
    showSyncStatus('Tempo match needs both decks loaded with BPM estimates.', 3500)
    return
  }
  const target = (a + b) / 2
  const rateA = Math.max(0.88, Math.min(1.12, target / a))
  const rateB = Math.max(0.88, Math.min(1.12, target / b))
  deckA.setPlaybackRate(rateA)
  deckB.setPlaybackRate(rateB)
  updatePhaseAndRateUi()
  const align = alignPhaseFollowerToMaster()
  let msg = `Tempo matched ≈${target.toFixed(1)} BPM (deck A ×${rateA.toFixed(3)}, deck B ×${rateB.toFixed(3)}). Playback uses buffer varispeed (pitch follows tempo).`
  if (align.ok) {
    if (align.already) {
      msg += ` Auto phase: deck ${align.follower} already aligned with ${align.master}.`
    } else {
      const sign = align.deltaMs >= 0 ? '+' : ''
      msg += ` Auto phase: nudged deck ${align.follower} ${sign}${align.deltaMs.toFixed(0)} ms to match deck ${align.master}.`
    }
  } else {
    msg += ` Auto phase skipped (${align.reason}). Middle tips still align phase manually.`
  }
  showSyncStatus(msg, 7000)
  afterTransportChange()
}

function applyPhaseAlignFromGesture(): void {
  const align = alignPhaseFollowerToMaster()
  if (!align.ok) {
    showSyncStatus(align.reason, 4000)
  } else if (align.already) {
    showSyncStatus(
      `Beat phase on deck ${align.follower} already matches deck ${align.master} (within a few ms).`,
      3500,
    )
  } else {
    const sign = align.deltaMs >= 0 ? '+' : ''
    showSyncStatus(
      `Nudged deck ${align.follower} ${sign}${align.deltaMs.toFixed(0)} ms to match deck ${align.master}.`,
      4500,
    )
  }
  afterTransportChange()
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatClockTenths(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0'
  const m = Math.floor(sec / 60)
  const whole = Math.floor(sec % 60)
  const t = Math.floor((sec - Math.floor(sec)) * 10)
  return `${m}:${whole.toString().padStart(2, '0')}.${t}`
}

function clampEqDb(db: number): number {
  return Math.max(-12, Math.min(12, db))
}

function resizeMiniWave(canvas: HTMLCanvasElement, ctx2d: CanvasRenderingContext2D): void {
  const wrap = canvas.parentElement!
  const dpr = window.devicePixelRatio || 1
  const w = wrap.clientWidth
  const h = ZOOM_WAVE_CSS_H
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  canvas.width = Math.floor(w * dpr)
  canvas.height = Math.floor(h * dpr)
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function colorsForDeck(canvas: HTMLCanvasElement): { wave: string; playhead: string } {
  const wave = getComputedStyle(canvas).getPropertyValue('--wave').trim() || '#6366f1'
  const playhead = getComputedStyle(canvas).getPropertyValue('--playhead').trim() || '#f9fafb'
  return { wave, playhead }
}

function redrawDeck(
  canvas: HTMLCanvasElement,
  ctx2d: CanvasRenderingContext2D,
  peaks: number[],
  deck: Deck,
  timeEl: HTMLSpanElement,
  analysis: TrackAnalysis | null,
): void {
  resizeMiniWave(canvas, ctx2d)
  const w = canvas.parentElement!.clientWidth
  const h = ZOOM_WAVE_CSS_H
  const { wave, playhead } = colorsForDeck(canvas)
  const effBpm =
    analysis && analysis.bpm > 40 ? analysis.bpm * deck.getPlaybackRate() : undefined
  const tri = deck === deckA ? triMiniA : triMiniB
  const mm = deck === deckA ? mmA : mmB
  const zoomKey: 'A' | 'B' = canvas === canvasA ? 'A' : 'B'
  const { t0, t1 } = zoomTimeWindow(deck, zoomKey)
  drawWaveformWindowed(
    ctx2d,
    w,
    h,
    peaks,
    deck.duration,
    t0,
    t1,
    deck.getCurrentTime(),
    wave,
    playhead,
    effBpm,
    tri,
    mm,
  )
  timeEl.textContent = `${formatTime(deck.getCurrentTime())} / ${formatTime(deck.duration)}`
}

function syncTransport(btn: HTMLButtonElement, deck: Deck): void {
  const hasTrack = deck.duration > 0
  btn.disabled = !hasTrack
  const playing = deck.isPlaying
  btn.setAttribute('aria-pressed', String(playing))
  btn.setAttribute('aria-label', playing ? 'Pause' : 'Play')
  btn.classList.toggle('is-playing', playing)
  const playWrap = btn.querySelector('[data-mode="play"]')
  const pauseWrap = btn.querySelector('[data-mode="pause"]')
  if (playWrap && pauseWrap) {
    playWrap.toggleAttribute('hidden', playing)
    pauseWrap.toggleAttribute('hidden', !playing)
  }
}

function redrawAll(): void {
  redrawDeck(canvasA, ctxA, peaksA, deckA, timeA, analysisA)
  redrawDeck(canvasB, ctxB, peaksB, deckB, timeB, analysisB)
  syncTransport(transportA, deckA)
  syncTransport(transportB, deckB)
  updatePhaseAndRateUi()
}

function tick(): void {
  redrawDeck(canvasA, ctxA, peaksA, deckA, timeA, analysisA)
  redrawDeck(canvasB, ctxB, peaksB, deckB, timeB, analysisB)
  syncTransport(transportA, deckA)
  syncTransport(transportB, deckB)
  updatePhaseAndRateUi()
  if (deckA.isPlaying || deckB.isPlaying) {
    raf = requestAnimationFrame(tick)
  }
}

function startRaf(): void {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(tick)
}

function afterTransportChange(): void {
  cancelAnimationFrame(raf)
  if (deckA.isPlaying || deckB.isPlaying) {
    startRaf()
  } else {
    redrawAll()
  }
}

function attachZoomScrubWheel(wrap: HTMLElement, deck: Deck, key: 'A' | 'B'): void {
  wrap.addEventListener(
    'wheel',
    (e) => {
      if (deck.duration <= 0) return
      e.preventDefault()
      const z = zoomWindowSecByDeck[key]
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
      zoomWindowSecByDeck[key] = Math.max(
        ZOOM_WINDOW_MIN,
        Math.min(ZOOM_WINDOW_MAX, z * factor),
      )
      redrawAll()
    },
    { passive: false },
  )

  let scrub: {
    pointerId: number
    startX: number
    startT: number
    span: number
    moved: boolean
  } | null = null

  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || deck.duration <= 0) return
    const { t0, t1 } = zoomTimeWindow(deck, key)
    const span = t1 - t0
    if (!(span > 0)) return
    scrub = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startT: deck.getCurrentTime(),
      span,
      moved: false,
    }
    wrap.classList.add('is-zoom-scrubbing')
    try {
      wrap.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  })

  wrap.addEventListener('pointermove', (e) => {
    if (!scrub || e.pointerId !== scrub.pointerId) return
    const rect = wrap.getBoundingClientRect()
    const wpx = rect.width
    if (wpx <= 0) return
    if (Math.abs(e.clientX - scrub.startX) > 4) scrub.moved = true
    const dt = ((e.clientX - scrub.startX) / wpx) * scrub.span
    deck.seekTo(Math.max(0, Math.min(deck.duration, scrub.startT + dt)))
    redrawAll()
  })

  const endScrub = (e: PointerEvent): void => {
    if (!scrub || e.pointerId !== scrub.pointerId) return
    try {
      if (wrap.hasPointerCapture(e.pointerId)) wrap.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const rect = wrap.getBoundingClientRect()
    const wpx = rect.width
    if (!scrub.moved && deck.duration > 0 && wpx > 0) {
      const { t0, t1 } = zoomTimeWindow(deck, key)
      const span = t1 - t0
      if (span > 0) {
        const frac = (e.clientX - rect.left) / wpx
        deck.seekTo(Math.max(0, Math.min(deck.duration, t0 + frac * span)))
      }
      afterTransportChange()
    } else if (scrub.moved) {
      afterTransportChange()
    }
    wrap.classList.remove('is-zoom-scrubbing')
    scrub = null
  }
  wrap.addEventListener('pointerup', endScrub)
  wrap.addEventListener('pointercancel', endScrub)
}

function applyCrossfaderFromUi(): void {
  mixer.setCrossfader(Number(crossfader.value) / 100)
}

crossfader.addEventListener('input', () => {
  applyCrossfaderFromUi()
})

volA.addEventListener('input', () => {
  mixer.setChannelVolume('A', Number(volA.value) / 100)
})

volB.addEventListener('input', () => {
  mixer.setChannelVolume('B', Number(volB.value) / 100)
})

alignPhaseBtn.addEventListener('click', () => {
  const align = alignPhaseFollowerToMaster()
  if (!align.ok) {
    showSyncStatus(align.reason, 4000)
    return
  }
  if (align.already) {
    showSyncStatus(
      `Beat phase on deck ${align.follower} already matches deck ${align.master} (within a few ms).`,
      3500,
    )
  } else {
    const sign = align.deltaMs >= 0 ? '+' : ''
    showSyncStatus(
      `Nudged deck ${align.follower} ${sign}${align.deltaMs.toFixed(0)} ms to match deck ${align.master}.`,
      4500,
    )
  }
  afterTransportChange()
})

eqALow.addEventListener('input', () => deckA.setEqLow(Number(eqALow.value)))
eqAMid.addEventListener('input', () => deckA.setEqMid(Number(eqAMid.value)))
eqAHigh.addEventListener('input', () => deckA.setEqHigh(Number(eqAHigh.value)))
eqBLow.addEventListener('input', () => deckB.setEqLow(Number(eqBLow.value)))
eqBMid.addEventListener('input', () => deckB.setEqMid(Number(eqBMid.value)))
eqBHigh.addEventListener('input', () => deckB.setEqHigh(Number(eqBHigh.value)))

const DEMO_A_TITLE =
  'Selena Gomez, The Marias, benny blanco — Ojos Tristes (Arial Ten Remix) [demo]'
const DEMO_B_TITLE = 'yukon (mang edit) v1 master [demo]'

function demoAssetUrl(path: string): string {
  const b = import.meta.env.BASE_URL
  return (b.endsWith('/') ? b : `${b}/`) + path
}

function commitLoadedBuffer(
  deck: Deck,
  buffer: AudioBuffer,
  displayName: string,
  metaEl: HTMLParagraphElement,
  transportBtn: HTMLButtonElement,
  setName: (s: string) => void,
  setPeaks: (p: number[]) => void,
  setAnalysis: (a: TrackAnalysis) => void,
): void {
  setName(displayName)
  setPeaks(computePeaks(buffer, WAVEFORM_BINS))
  const mmBins = computeSignedMinMaxBins(buffer, WAVEFORM_BINS)
  if (deck === deckA) {
    triMiniA = computeTriBandPeaks(buffer, WAVEFORM_BINS)
    mmA = mmBins
    kicksA = computeKickMarkers(buffer)
  } else {
    triMiniB = computeTriBandPeaks(buffer, WAVEFORM_BINS)
    mmB = mmBins
    kicksB = computeKickMarkers(buffer)
  }
  const analysis = analyzeTrack(buffer)
  setAnalysis(analysis)
  metaEl.textContent = `BPM ~${analysis.bpm} · ${analysis.keyLabel} (${analysis.camelot}) · estimates`
  syncTransport(transportBtn, deck)
  redrawAll()
}

async function onPickFile(
  file: File | undefined,
  deck: Deck,
  setName: (s: string) => void,
  metaEl: HTMLParagraphElement,
  transportBtn: HTMLButtonElement,
  setPeaks: (p: number[]) => void,
  setAnalysis: (a: TrackAnalysis) => void,
): Promise<void> {
  if (!file) return
  setName(file.name)
  metaEl.textContent = 'Analyzing…'
  transportBtn.disabled = true
  const buffer = await deck.loadFile(file)
  commitLoadedBuffer(deck, buffer, file.name, metaEl, transportBtn, setName, setPeaks, setAnalysis)
}

async function loadDemoTracks(): Promise<void> {
  try {
    const [rawA, rawB] = await Promise.all([
      fetch(demoAssetUrl('demo/deck-a.m4a')).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.arrayBuffer()
      }),
      fetch(demoAssetUrl('demo/deck-b.mp3')).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.arrayBuffer()
      }),
    ])
    metaA.textContent = 'Loading demo…'
    metaB.textContent = 'Loading demo…'
    transportA.disabled = true
    transportB.disabled = true
    const [bufA, bufB] = await Promise.all([
      deckA.loadFromArrayBuffer(rawA),
      deckB.loadFromArrayBuffer(rawB),
    ])
    commitLoadedBuffer(
      deckA,
      bufA,
      DEMO_A_TITLE,
      metaA,
      transportA,
      (s) => {
        nameA.textContent = s
      },
      (p) => {
        peaksA = p
      },
      (a) => {
        analysisA = a
      },
    )
    commitLoadedBuffer(
      deckB,
      bufB,
      DEMO_B_TITLE,
      metaB,
      transportB,
      (s) => {
        nameB.textContent = s
      },
      (p) => {
        peaksB = p
      },
      (a) => {
        analysisB = a
      },
    )
  } catch (err) {
    console.warn('Demo tracks:', err)
    nameA.textContent = 'No track'
    nameB.textContent = 'No track'
    metaA.textContent = 'Load audio — demo files not found.'
    metaB.textContent = 'Load audio — demo files not found.'
    syncTransport(transportA, deckA)
    syncTransport(transportB, deckB)
    redrawAll()
  }
}

fileA.addEventListener('change', () => {
  void onPickFile(
    fileA.files?.[0],
    deckA,
    (s) => (nameA.textContent = s),
    metaA,
    transportA,
    (p) => {
      peaksA = p
    },
    (a) => {
      analysisA = a
    },
  )
})

fileB.addEventListener('change', () => {
  void onPickFile(
    fileB.files?.[0],
    deckB,
    (s) => (nameB.textContent = s),
    metaB,
    transportB,
    (p) => {
      peaksB = p
    },
    (a) => {
      analysisB = a
    },
  )
})

transportA.addEventListener('click', async () => {
  if (deckA.isPlaying) {
    deckA.pause()
  } else {
    await deckA.play()
  }
  afterTransportChange()
})

transportB.addEventListener('click', async () => {
  if (deckB.isPlaying) {
    deckB.pause()
  } else {
    await deckB.play()
  }
  afterTransportChange()
})

function buildHandGestureLoopOptions(): HandGestureLoopOptions {
  return {
    video: camVideo,
    overlay: handOverlay,
    crossfader,
    volA,
    volB,
    eqInputs: {
      A: { low: eqALow, mid: eqAMid, high: eqAHigh },
      B: { low: eqBLow, mid: eqBMid, high: eqBHigh },
    },
    callbacks: {
      setCrossfader: (t) => mixer.setCrossfader(t),
      setChannelVolume: (deck, t) => mixer.setChannelVolume(deck, t),
      toggleTransport: async (deck) => {
        if (deck === 'A') {
          if (deckA.isPlaying) deckA.pause()
          else await deckA.play()
        } else {
          if (deckB.isPlaying) deckB.pause()
          else await deckB.play()
        }
        afterTransportChange()
      },
      getCrossfader: () => mixer.getCrossfader(),
      getChannelVolume: (deck) => mixer.getChannelVolume(deck),
      getEq: (deck, band) => {
        const el =
          deck === 'A'
            ? band === 'low'
              ? eqALow
              : band === 'mid'
                ? eqAMid
                : eqAHigh
            : band === 'low'
              ? eqBLow
              : band === 'mid'
                ? eqBMid
                : eqBHigh
        return Number(el.value)
      },
      setEq: (deck, band, db) => {
        const v = clampEqDb(db)
        const d = deck === 'A' ? deckA : deckB
        const el =
          deck === 'A'
            ? band === 'low'
              ? eqALow
              : band === 'mid'
                ? eqAMid
                : eqAHigh
            : band === 'low'
              ? eqBLow
              : band === 'mid'
                ? eqBMid
                : eqBHigh
        if (band === 'low') d.setEqLow(v)
        else if (band === 'mid') d.setEqMid(v)
        else d.setEqHigh(v)
        el.value = String(v)
      },
      getDeckHud: (deck) => {
        const d = deck === 'A' ? deckA : deckB
        const title = (deck === 'A' ? nameA : nameB).textContent ?? 'No track'
        const analysis = deck === 'A' ? analysisA : analysisB
        const dur = d.duration
        const cur = d.getCurrentTime()
        const progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0
        const rate = d.getPlaybackRate()
        const effBpm = analysis && analysis.bpm > 0 ? analysis.bpm * rate : 0
        const ph = effBpm > 0 ? beatPhase01(effBpm, cur) : 0
        const bpmLine = analysis ? `~${Math.round(analysis.bpm * rate)}` : '—'
        const keyLine = analysis
          ? `${analysis.keyLabel} · ${analysis.camelot}`
          : '—'
        const tempoKeyLine =
          Math.abs(rate - 1) < 0.0005
            ? `${rate.toFixed(2)}×`
            : `${rate.toFixed(3)}× varispeed`
        return {
          deckLine: deck === 'A' ? 'DECK A' : 'DECK B',
          title,
          bpmLine,
          keyLine,
          elapsed: formatClockTenths(cur),
          remaining: dur > 0 ? `-${formatClockTenths(dur - cur)}` : '—',
          progress,
          beatPhase01: ph,
          playbackRate: rate,
          tempoKeyLine,
        }
      },
      onTempoMatch: () => applyTempoMatchFromGesture(),
      onPhaseAlign: () => applyPhaseAlignFromGesture(),
      isDeckPlaying: (deck) => (deck === 'A' ? deckA : deckB).isPlaying,
      setJogTempo: (deck, mult) => (deck === 'A' ? deckA : deckB).setJogTempoMultiplier(mult),
      resetJogTempo: (deck) => (deck === 'A' ? deckA : deckB).resetJogTempoMultiplier(),
    },
  }
}

function stopHandGesturesUi(): void {
  handStatus.hidden = true
  stopHandGestureLoop()
  deckA.resetJogTempoMultiplier()
  deckB.resetJogTempoMultiplier()
  performancePanel.classList.remove('hand-gestures-active')
}

let handGestureLoopLoading = false

function beginHandGesturesAsync(): void {
  if (!cameraOn || handGestureLoopLoading) return
  handGestureLoopLoading = true
  handStatus.hidden = false
  void startHandGestureLoop(buildHandGestureLoopOptions(), () => cameraOn)
    .then(() => {
      handStatus.hidden = true
      if (cameraOn) {
        performancePanel.classList.add('hand-gestures-active')
      }
    })
    .catch((err: unknown) => {
      console.error(err)
      performancePanel.classList.remove('hand-gestures-active')
      handStatus.hidden = true
      deckA.resetJogTempoMultiplier()
      deckB.resetJogTempoMultiplier()
      const msg = err instanceof Error ? err.message : 'Hand model failed to load'
      alert(msg)
    })
    .finally(() => {
      handGestureLoopLoading = false
    })
}

camToggle.addEventListener('click', () => {
  if (cameraOn) {
    stopHandGesturesUi()
    stopWebcamPreview(camVideo)
    disposeHandLandmarker()
    cameraOn = false
    camToggle.textContent = 'Start camera'
  } else {
    void startWebcamPreview(camVideo).then(
      () => {
        cameraOn = true
        camToggle.textContent = 'Stop camera'
        beginHandGesturesAsync()
      },
      (err: unknown) => {
        console.error(err)
        const msg = err instanceof Error ? err.message : 'Could not access camera'
        alert(msg)
      },
    )
  }
})

window.addEventListener('resize', () => {
  redrawAll()
})

attachZoomScrubWheel(zoomWrapA, deckA, 'A')
attachZoomScrubWheel(zoomWrapB, deckB, 'B')

void loadDemoTracks()
