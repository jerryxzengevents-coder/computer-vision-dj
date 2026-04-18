/** Downsample audio to peak values per horizontal bin (for waveform UI). */
export function computePeaks(buffer: AudioBuffer, numBins: number): number[] {
  const channels = buffer.numberOfChannels
  const len = buffer.length
  const block = len / numBins
  const peaks = new Array<number>(numBins)

  for (let i = 0; i < numBins; i++) {
    const start = Math.floor(i * block)
    const end = Math.min(len, Math.floor((i + 1) * block))
    let m = 0
    for (let j = start; j < end; j++) {
      for (let c = 0; c < channels; c++) {
        const v = Math.abs(buffer.getChannelData(c)[j]!)
        if (v > m) m = v
      }
    }
    peaks[i] = m
  }
  return peaks
}

export type TriBandPeaks = {
  low: number[]
  mid: number[]
  high: number[]
}

/** Per-bin rough low / mid / high energy (IIR-ish split) for colored waveforms. */
export function computeTriBandPeaks(buffer: AudioBuffer, numBins: number): TriBandPeaks {
  const channels = buffer.numberOfChannels
  const len = buffer.length
  const sr = buffer.sampleRate
  const block = len / numBins
  const slowA = Math.exp(-2 / Math.max(80, sr * 0.05))
  const fastA = Math.exp(-2 / Math.max(40, sr * 0.004))
  const low: number[] = []
  const mid: number[] = []
  const high: number[] = []

  for (let i = 0; i < numBins; i++) {
    const start = Math.floor(i * block)
    const end = Math.min(len, Math.floor((i + 1) * block))
    let sLo = 0
    let sMd = 0
    let sHi = 0
    let emaS = 0
    let emaF = 0
    const span = Math.max(1, end - start)
    for (let j = start; j < end; j++) {
      let x = 0
      for (let c = 0; c < channels; c++) {
        x += buffer.getChannelData(c)[j]!
      }
      x /= channels
      emaS = slowA * emaS + (1 - slowA) * x
      emaF = fastA * emaF + (1 - fastA) * x
      const hi = x - emaF
      sLo += Math.abs(emaS)
      sMd += Math.abs(emaF - emaS)
      sHi += Math.abs(hi)
    }
    low.push(sLo / span)
    mid.push(sMd / span)
    high.push(sHi / span)
  }
  let mx = 1e-8
  for (let i = 0; i < numBins; i++) {
    mx = Math.max(mx, low[i]!, mid[i]!, high[i]!)
  }
  return {
    low: low.map((v) => v / mx),
    mid: mid.map((v) => v / mx),
    high: high.map((v) => v / mx),
  }
}

/** Signed waveform range per bin (normalized), for dense vertical “hair” columns. */
export type SignedMmBins = { min: number[]; max: number[] }

/** Per-bin min/max sample (mono mix), scaled so global peak is 1. */
export function computeSignedMinMaxBins(buffer: AudioBuffer, numBins: number): SignedMmBins {
  const channels = buffer.numberOfChannels
  const len = buffer.length
  const block = len / numBins
  const minArr = new Array<number>(numBins)
  const maxArr = new Array<number>(numBins)
  let absPeak = 1e-8

  for (let i = 0; i < numBins; i++) {
    const start = Math.floor(i * block)
    const end = Math.min(len, Math.floor((i + 1) * block))
    let loS = Infinity
    let hiS = -Infinity
    for (let j = start; j < end; j++) {
      let x = 0
      for (let c = 0; c < channels; c++) {
        x += buffer.getChannelData(c)[j]!
      }
      x /= channels
      if (x < loS) loS = x
      if (x > hiS) hiS = x
    }
    if (loS === Infinity) {
      loS = 0
      hiS = 0
    }
    minArr[i] = loS
    maxArr[i] = hiS
    absPeak = Math.max(absPeak, Math.abs(loS), Math.abs(hiS))
  }

  const inv = 1 / absPeak
  for (let i = 0; i < numBins; i++) {
    minArr[i]! *= inv
    maxArr[i]! *= inv
  }
  return { min: minArr, max: maxArr }
}

/** Rekordbox-style: bass → red/orange, mids → magenta, highs → cyan. */
function djRgbGranular(lo: number, md: number, hi: number): string {
  const s = lo + md + hi + 1e-8
  const L = lo / s
  const M = md / s
  const H = hi / s
  const r = Math.round(L * 255 + M * 255 + H * 35)
  const g = Math.round(L * 88 + M * 60 + H * 230)
  const b = Math.round(L * 45 + M * 200 + H * 248)
  return `rgb(${r},${g},${b})`
}

type GranularAgg = {
  colMin: number[]
  colMax: number[]
  colorIdx: number[]
  maxAmp: number
}

function aggregateGranularColumns(
  peaks: number[],
  mm: SignedMmBins | null,
  duration: number,
  windowT0: number,
  windowT1: number,
  numCols: number,
): GranularAgg {
  const colMin = new Array<number>(numCols)
  const colMax = new Array<number>(numCols)
  const colorIdx = new Array<number>(numCols)
  const span = Math.max(1e-9, windowT1 - windowT0)
  const nPeaks = peaks.length
  const peakIdxPerSec = nPeaks / Math.max(1e-9, duration)
  const useMm = Boolean(mm && mm.min.length === nPeaks && mm.max.length === nPeaks)
  let maxAmp = 1e-8

  for (let j = 0; j < numCols; j++) {
    const t0 = windowT0 + (j / numCols) * span
    const t1 = windowT0 + ((j + 1) / numCols) * span
    let i0 = Math.floor(t0 * peakIdxPerSec)
    let i1 = Math.ceil(t1 * peakIdxPerSec) - 1
    if (i1 < i0) i1 = i0
    i0 = Math.max(0, Math.min(nPeaks - 1, i0))
    i1 = Math.max(0, Math.min(nPeaks - 1, i1))

    let best = peaks[i0]!
    let bestI = i0
    for (let i = i0 + 1; i <= i1; i++) {
      const p = peaks[i]!
      if (p > best) {
        best = p
        bestI = i
      }
    }

    let cmin: number
    let cmax: number
    let ci: number
    if (useMm && mm) {
      cmin = mm.min[i0]!
      cmax = mm.max[i0]!
      let bestSpan = mm.max[i0]! - mm.min[i0]!
      ci = i0
      for (let i = i0 + 1; i <= i1; i++) {
        const mn = mm.min[i]!
        const mx = mm.max[i]!
        if (mn < cmin) cmin = mn
        if (mx > cmax) cmax = mx
        const sp = mx - mn
        if (sp > bestSpan) {
          bestSpan = sp
          ci = i
        }
      }
    } else {
      cmin = -best
      cmax = best
      ci = bestI
    }

    colMin[j] = cmin
    colMax[j] = cmax
    colorIdx[j] = ci
    maxAmp = Math.max(maxAmp, Math.abs(cmin), Math.abs(cmax))
  }

  return { colMin, colMax, colorIdx, maxAmp: Math.max(1e-6, maxAmp) }
}

function drawGranularWaveformColumns(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
  mid: number,
  numCols: number,
  colMin: number[],
  colMax: number[],
  colorIdx: number[],
  maxAmp: number,
  tri: TriBandPeaks | null,
  monoRgb: string,
): void {
  if (numCols < 1) return
  const scale = (height * 0.44) / maxAmp
  const barW = Math.max(1, width / numCols + 0.55)
  const hasTri = Boolean(tri && tri.low.length > 0)

  for (let j = 0; j < numCols; j++) {
    const xa = (j / numCols) * width
    const cmin = colMin[j]!
    const cmax = colMax[j]!
    const yTop = mid - cmax * scale
    const yBot = mid - cmin * scale
    const top = Math.min(yTop, yBot)
    const hcol = Math.max(1, Math.abs(yBot - yTop))
    const ki = colorIdx[j]!
    if (hasTri && tri) {
      ctx2d.fillStyle = djRgbGranular(tri.low[ki]!, tri.mid[ki]!, tri.high[ki]!)
      ctx2d.globalAlpha = 0.92
    } else {
      ctx2d.fillStyle = monoRgb
      ctx2d.globalAlpha = 0.78
    }
    ctx2d.fillRect(xa, top, barW, hcol)
  }
  ctx2d.globalAlpha = 1
}

function drawBeatPhaseGrid(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
  durationSec: number,
  bpmEffective: number,
  barLineRgba: string,
  beatLineRgba: string,
): void {
  if (!(durationSec > 0 && bpmEffective > 40 && bpmEffective < 300)) return
  const beatSec = 60 / bpmEffective
  if (!(beatSec > 0.04 && beatSec < 2)) return
  ctx2d.save()
  const maxBeats = Math.ceil(durationSec / beatSec) + 1
  for (let bi = 1; bi < maxBeats; bi++) {
    const t = bi * beatSec
    if (t >= durationSec) break
    const x = (t / durationSec) * width
    const isBar = bi % 4 === 0
    ctx2d.beginPath()
    ctx2d.moveTo(x + 0.5, 0)
    ctx2d.lineTo(x + 0.5, height)
    ctx2d.strokeStyle = isBar ? barLineRgba : beatLineRgba
    ctx2d.lineWidth = isBar ? 1.65 : 1
    ctx2d.stroke()
  }
  ctx2d.restore()
}

function drawBeatPhaseGridWindowed(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
  windowT0: number,
  windowT1: number,
  bpmEffective: number,
  barLineRgba: string,
  beatLineRgba: string,
): void {
  const span = windowT1 - windowT0
  if (!(span > 0 && bpmEffective > 40 && bpmEffective < 300)) return
  const beatSec = 60 / bpmEffective
  if (!(beatSec > 0.04 && beatSec < 2)) return
  ctx2d.save()
  const bi0 = Math.max(1, Math.floor(windowT0 / beatSec))
  const bi1 = Math.ceil(windowT1 / beatSec) + 2
  for (let bi = bi0; bi < bi1; bi++) {
    const t = bi * beatSec
    if (t <= windowT0 + 1e-6 || t >= windowT1 - 1e-6) continue
    const x = ((t - windowT0) / span) * width
    const isBar = bi % 4 === 0
    ctx2d.beginPath()
    ctx2d.moveTo(x + 0.5, 0)
    ctx2d.lineTo(x + 0.5, height)
    ctx2d.strokeStyle = isBar ? barLineRgba : beatLineRgba
    ctx2d.lineWidth = isBar ? 1.65 : 1
    ctx2d.stroke()
  }
  ctx2d.restore()
}

export function drawWaveform(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
  peaks: number[],
  duration: number,
  current: number,
  waveColor: string,
  playheadColor: string,
  bpmEffective?: number,
  tri?: TriBandPeaks | null,
  mm?: SignedMmBins | null,
): void {
  ctx2d.clearRect(0, 0, width, height)
  const mid = height / 2

  if (bpmEffective != null && duration > 0) {
    drawBeatPhaseGrid(
      ctx2d,
      width,
      height,
      duration,
      bpmEffective,
      'rgba(255,255,255,0.22)',
      'rgba(255,255,255,0.08)',
    )
  }

  if (peaks.length >= 1) {
    const numCols = Math.max(160, Math.min(2200, Math.floor(width * 3.5)))
    const { colMin, colMax, colorIdx, maxAmp } = aggregateGranularColumns(
      peaks,
      mm ?? null,
      duration,
      0,
      duration,
      numCols,
    )
    drawGranularWaveformColumns(
      ctx2d,
      width,
      height,
      mid,
      numCols,
      colMin,
      colMax,
      colorIdx,
      maxAmp,
      tri ?? null,
      waveColor,
    )
  }

  if (duration > 0) {
    const x = (current / duration) * width
    ctx2d.beginPath()
    ctx2d.moveTo(x, 0)
    ctx2d.lineTo(x, height)
    ctx2d.strokeStyle = 'rgba(255, 50, 50, 0.4)'
    ctx2d.lineWidth = 4
    ctx2d.stroke()
    ctx2d.strokeStyle = playheadColor
    ctx2d.lineWidth = 2
    ctx2d.stroke()
  }
}

/** Zoomed slice [windowT0, windowT1] of the full peaks; playhead at `current` (usually near center). */
export function drawWaveformWindowed(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
  peaks: number[],
  duration: number,
  windowT0: number,
  windowT1: number,
  current: number,
  waveColor: string,
  playheadColor: string,
  bpmEffective?: number,
  tri?: TriBandPeaks | null,
  mm?: SignedMmBins | null,
): void {
  ctx2d.clearRect(0, 0, width, height)
  const span = Math.max(1e-6, windowT1 - windowT0)
  if (peaks.length === 0 || duration <= 0) return

  const mid = height / 2
  const numCols = Math.max(200, Math.min(2600, Math.floor(width * 4)))

  if (bpmEffective != null) {
    drawBeatPhaseGridWindowed(
      ctx2d,
      width,
      height,
      windowT0,
      windowT1,
      bpmEffective,
      'rgba(255,255,255,0.24)',
      'rgba(255,255,255,0.09)',
    )
  }

  const { colMin, colMax, colorIdx, maxAmp } = aggregateGranularColumns(
    peaks,
    mm ?? null,
    duration,
    windowT0,
    windowT1,
    numCols,
  )
  drawGranularWaveformColumns(
    ctx2d,
    width,
    height,
    mid,
    numCols,
    colMin,
    colMax,
    colorIdx,
    maxAmp,
    tri ?? null,
    waveColor,
  )

  const px = ((current - windowT0) / span) * width
  if (px >= -4 && px <= width + 4) {
    ctx2d.beginPath()
    ctx2d.moveTo(px + 0.5, 0)
    ctx2d.lineTo(px + 0.5, height)
    ctx2d.strokeStyle = 'rgba(255, 50, 50, 0.45)'
    ctx2d.lineWidth = 5
    ctx2d.stroke()
    ctx2d.strokeStyle = playheadColor
    ctx2d.lineWidth = 2
    ctx2d.stroke()
  }
}

/**
 * Full-track overview for scrolling strip (playhead is fixed center line in UI).
 */
export function drawScrollWaveform(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
  peaks: number[],
  waveRgb: string,
  gridRgb: string,
  durationSec: number,
  bpmEffective?: number,
  tri?: TriBandPeaks | null,
  mm?: SignedMmBins | null,
): void {
  ctx2d.clearRect(0, 0, width, height)
  ctx2d.fillStyle = 'rgba(0,0,0,0.94)'
  ctx2d.fillRect(0, 0, width, height)

  const mid = height / 2

  if (bpmEffective != null && durationSec > 0) {
    drawBeatPhaseGrid(
      ctx2d,
      width,
      height,
      durationSec,
      bpmEffective,
      'rgba(255,255,255,0.2)',
      'rgba(255,255,255,0.07)',
    )
  }

  if (peaks.length >= 1) {
    const numCols = Math.max(180, Math.min(2400, Math.floor(width * 3.2)))
    const { colMin, colMax, colorIdx, maxAmp } = aggregateGranularColumns(
      peaks,
      mm ?? null,
      durationSec,
      0,
      durationSec,
      numCols,
    )
    drawGranularWaveformColumns(
      ctx2d,
      width,
      height,
      mid,
      numCols,
      colMin,
      colMax,
      colorIdx,
      maxAmp,
      tri ?? null,
      waveRgb,
    )
  }

  ctx2d.strokeStyle = gridRgb
  ctx2d.lineWidth = 1
  ctx2d.beginPath()
  ctx2d.moveTo(0, mid)
  ctx2d.lineTo(width, mid)
  ctx2d.stroke()
}

/** Fixed top-right style stacked A/B overview (Serato-ish). */
export function drawStackedDualOverview(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  rowHeight: number,
  peaksA: number[],
  peaksB: number[],
  durA: number,
  durB: number,
  curA: number,
  curB: number,
  triA: TriBandPeaks | null,
  triB: TriBandPeaks | null,
  mmA: SignedMmBins | null,
  mmB: SignedMmBins | null,
  monoRgbA: string,
  monoRgbB: string,
): void {
  ctx2d.clearRect(0, 0, width, rowHeight * 2 + 6)
  ctx2d.fillStyle = 'rgba(10,12,20,0.92)'
  ctx2d.fillRect(0, 0, width, rowHeight * 2 + 6)
  ctx2d.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx2d.strokeRect(0.5, 0.5, width - 1, rowHeight * 2 + 5)

  const drawRow = (
    y0: number,
    peaks: number[],
    dur: number,
    cur: number,
    tri: TriBandPeaks | null,
    mm: SignedMmBins | null,
    label: string,
    monoRgb: string,
  ): void => {
    ctx2d.save()
    ctx2d.beginPath()
    ctx2d.rect(0, y0, width, rowHeight)
    ctx2d.clip()
    const mid = y0 + rowHeight / 2
    if (peaks.length >= 1) {
      const numCols = Math.max(120, Math.min(1600, Math.floor(width * 2.8)))
      const { colMin, colMax, colorIdx, maxAmp } = aggregateGranularColumns(
        peaks,
        mm,
        Math.max(1e-6, dur),
        0,
        Math.max(1e-6, dur),
        numCols,
      )
      drawGranularWaveformColumns(
        ctx2d,
        width,
        rowHeight,
        mid,
        numCols,
        colMin,
        colMax,
        colorIdx,
        maxAmp,
        tri,
        monoRgb,
      )
    }
    if (dur > 0) {
      const px = (cur / dur) * width
      ctx2d.strokeStyle = 'rgba(250,250,250,0.95)'
      ctx2d.lineWidth = 1.5
      ctx2d.beginPath()
      ctx2d.moveTo(px, y0 + 2)
      ctx2d.lineTo(px, y0 + rowHeight - 2)
      ctx2d.stroke()
    }
    ctx2d.restore()
    ctx2d.fillStyle = 'rgba(226,232,240,0.75)'
    ctx2d.font = '600 9px system-ui,sans-serif'
    ctx2d.fillText(label, 6, y0 + 11)
  }

  drawRow(0, peaksA, durA, curA, triA, mmA, 'A', monoRgbA)
  drawRow(rowHeight + 3, peaksB, durB, curB, triB, mmB, 'B', monoRgbB)
}
