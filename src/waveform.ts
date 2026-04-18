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

function drawTriBandColumn(
  ctx2d: CanvasRenderingContext2D,
  x: number,
  midY: number,
  barW: number,
  maxH: number,
  lo: number,
  md: number,
  hi: number,
): void {
  const t = lo + md + hi + 1e-6
  const hTotal = ((lo + md + hi) / 3) * maxH * 1.65
  const hLo = (lo / t) * hTotal
  const hMd = (md / t) * hTotal
  const hHi = (hi / t) * hTotal
  let y0 = midY + hTotal / 2
  ctx2d.fillStyle = `rgb(${Math.round(110 + 120 * (lo / t))},${Math.round(40 + 70 * (md / t))},${Math.round(140 + 90 * (hi / t))})`
  y0 -= hHi
  ctx2d.fillRect(x, y0, barW, hHi)
  ctx2d.fillStyle = `rgb(${Math.round(60 + 100 * (lo / t))},${Math.round(120 + 100 * (md / t))},${Math.round(50 + 80 * (hi / t))})`
  y0 -= hMd
  ctx2d.fillRect(x, y0, barW, hMd)
  ctx2d.fillStyle = `rgb(${Math.round(200 + 55 * (lo / t))},${Math.round(70 + 60 * (md / t))},${Math.round(60 + 40 * (hi / t))})`
  y0 -= hLo
  ctx2d.fillRect(x, y0, barW, hLo)
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
): void {
  ctx2d.clearRect(0, 0, width, height)
  const mid = height / 2
  const maxBar = peaks.length > 0 ? Math.max(...peaks, 0.0001) : 1
  const barW = Math.max(1, width / peaks.length - 0.5)

  if (tri && tri.low.length === peaks.length) {
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * width
      const m = (peaks[i]! / maxBar) * (height * 0.42)
      drawTriBandColumn(ctx2d, x, mid, barW, m * 2.2, tri.low[i]!, tri.mid[i]!, tri.high[i]!)
    }
  } else {
    ctx2d.fillStyle = waveColor
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * width
      const barH = (peaks[i]! / maxBar) * (height * 0.42)
      ctx2d.fillRect(x, mid - barH, barW, barH * 2)
    }
  }

  if (bpmEffective != null && duration > 0) {
    drawBeatPhaseGrid(
      ctx2d,
      width,
      height,
      duration,
      bpmEffective,
      'rgba(255,255,255,0.32)',
      'rgba(255,255,255,0.09)',
    )
  }

  if (duration > 0) {
    const x = (current / duration) * width
    ctx2d.strokeStyle = playheadColor
    ctx2d.lineWidth = 2
    ctx2d.beginPath()
    ctx2d.moveTo(x, 0)
    ctx2d.lineTo(x, height)
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
): void {
  ctx2d.clearRect(0, 0, width, height)
  const span = Math.max(1e-6, windowT1 - windowT0)
  if (peaks.length === 0 || duration <= 0) return

  const mid = height / 2
  const numCols = Math.max(48, Math.min(1400, Math.floor(width * 2)))
  const wpeaks: number[] = new Array(numCols)
  const hasTri = Boolean(tri && tri.low.length === peaks.length)
  const wlo: number[] = hasTri ? new Array(numCols) : []
  const wmd: number[] = hasTri ? new Array(numCols) : []
  const whi: number[] = hasTri ? new Array(numCols) : []

  for (let j = 0; j < numCols; j++) {
    const u = (j + 0.5) / numCols
    const t = windowT0 + u * span
    const idx = Math.floor((t / duration) * peaks.length)
    const i = Math.max(0, Math.min(peaks.length - 1, idx))
    wpeaks[j] = peaks[i]!
    if (hasTri && tri) {
      wlo[j] = tri.low[i]!
      wmd[j] = tri.mid[i]!
      whi[j] = tri.high[i]!
    }
  }

  const maxBar = Math.max(...wpeaks, 0.0001)
  const barW = Math.max(1, width / numCols - 0.35)

  if (hasTri && tri) {
    for (let j = 0; j < numCols; j++) {
      const x = (j / numCols) * width
      const m = (wpeaks[j]! / maxBar) * (height * 0.42)
      drawTriBandColumn(ctx2d, x, mid, barW, m * 2.2, wlo[j]!, wmd[j]!, whi[j]!)
    }
  } else {
    ctx2d.fillStyle = waveColor
    for (let j = 0; j < numCols; j++) {
      const x = (j / numCols) * width
      const barH = (wpeaks[j]! / maxBar) * (height * 0.42)
      ctx2d.fillRect(x, mid - barH, barW, barH * 2)
    }
  }

  if (bpmEffective != null) {
    drawBeatPhaseGridWindowed(
      ctx2d,
      width,
      height,
      windowT0,
      windowT1,
      bpmEffective,
      'rgba(255,255,255,0.36)',
      'rgba(255,255,255,0.11)',
    )
  }

  const px = ((current - windowT0) / span) * width
  if (px >= -4 && px <= width + 4) {
    ctx2d.strokeStyle = playheadColor
    ctx2d.lineWidth = 2.25
    ctx2d.beginPath()
    ctx2d.moveTo(px + 0.5, 0)
    ctx2d.lineTo(px + 0.5, height)
    ctx2d.stroke()
  }
}

/**
 * Full-track overview for scrolling strip (playhead is fixed center line in UI).
 * Optional tri-band colors: low=red-ish, mid=green-ish, high=blue-ish per column.
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
): void {
  ctx2d.clearRect(0, 0, width, height)
  ctx2d.fillStyle = 'rgba(6,8,12,0.95)'
  ctx2d.fillRect(0, 0, width, height)

  const mid = height / 2
  const maxBar = peaks.length > 0 ? Math.max(...peaks, 0.0001) : 1
  const barW = Math.max(1, width / peaks.length)

  ctx2d.strokeStyle = gridRgb
  ctx2d.lineWidth = 1
  ctx2d.beginPath()
  ctx2d.moveTo(0, mid)
  ctx2d.lineTo(width, mid)
  ctx2d.stroke()

  if (tri && tri.low.length === peaks.length) {
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * width
      const m = (peaks[i]! / maxBar) * (height * 0.44)
      drawTriBandColumn(ctx2d, x, mid, barW - 0.25, m * 2.25, tri.low[i]!, tri.mid[i]!, tri.high[i]!)
    }
  } else {
    ctx2d.fillStyle = waveRgb
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * width
      const barH = (peaks[i]! / maxBar) * (height * 0.44)
      ctx2d.fillRect(x, mid - barH, barW - 0.25, barH * 2)
    }
  }

  if (bpmEffective != null && durationSec > 0) {
    drawBeatPhaseGrid(
      ctx2d,
      width,
      height,
      durationSec,
      bpmEffective,
      'rgba(255,255,255,0.38)',
      'rgba(255,255,255,0.1)',
    )
  }
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
    label: string,
    monoRgb: string,
  ): void => {
    ctx2d.save()
    ctx2d.beginPath()
    ctx2d.rect(0, y0, width, rowHeight)
    ctx2d.clip()
    const mid = y0 + rowHeight / 2
    const maxP = peaks.length ? Math.max(...peaks, 1e-6) : 1
    const barW = Math.max(1, width / Math.max(1, peaks.length))
    if (tri && tri.low.length === peaks.length) {
      for (let i = 0; i < peaks.length; i++) {
        const x = (i / peaks.length) * width
        const m = (peaks[i]! / maxP) * (rowHeight * 0.38)
        drawTriBandColumn(ctx2d, x, mid, barW - 0.2, m * 2.1, tri.low[i]!, tri.mid[i]!, tri.high[i]!)
      }
    } else {
      ctx2d.fillStyle = monoRgb
      for (let i = 0; i < peaks.length; i++) {
        const x = (i / peaks.length) * width
        const h = (peaks[i]! / maxP) * (rowHeight * 0.38)
        ctx2d.fillRect(x, mid - h, barW - 0.2, h * 2)
      }
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

  drawRow(0, peaksA, durA, curA, triA, 'A', monoRgbA)
  drawRow(rowHeight + 3, peaksB, durB, curB, triB, 'B', monoRgbB)
}
