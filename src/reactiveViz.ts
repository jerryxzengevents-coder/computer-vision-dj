/** Full-screen canvas: red strobes + reactive laser shapes, driven by audio + mixer UI. */

export type VizUiSnapshot = {
  /** 0…1 channel faders */
  volA: number
  volB: number
  /** 0 = deck A, 1 = deck B */
  crossfader: number
  /** dB −12…+12 (weighted by crossfader) */
  eqLow: number
  eqMid: number
  eqHigh: number
}

type LaserKind = 'sweep' | 'fan' | 'slash' | 'helix' | 'orbit'

type Laser = {
  kind: LaserKind
  life: number
  phase: number
  cx: number
  cy: number
  angle: number
  spin: number
  hue: number
  span: number
  /** kind-specific */
  r0: number
  r1: number
}

const MAX_LASERS = 14

function bandHue(low: number, mid: number, high: number): number {
  const s = low + mid + high + 1e-6
  const L = low / s
  const M = mid / s
  const H = high / s
  return (L * 2 + M * 312 + H * 188) % 360
}

function spawnLaser(
  w: number,
  h: number,
  low: number,
  mid: number,
  high: number,
  flux: number,
  bassKick: number,
  vMix: number,
  lasers: Laser[],
): void {
  if (lasers.length >= MAX_LASERS) return
  const p = 0.018 + flux * 0.55 + bassKick * 0.22 + mid * 0.04
  if (Math.random() > p * (0.35 + vMix * 0.65)) return

  const kinds: LaserKind[] = ['sweep', 'fan', 'slash', 'helix', 'orbit']
  const kind = kinds[Math.floor(Math.random() * kinds.length)]!
  const hue = bandHue(low, mid, high) + Math.random() * 28 - 14
  const cx = w * (0.12 + Math.random() * 0.76)
  const cy = h * (0.1 + Math.random() * 0.8)
  const angle = Math.random() * Math.PI * 2
  const spin = (Math.random() < 0.5 ? -1 : 1) * (0.04 + Math.random() * 0.1)
  lasers.push({
    kind,
    life: 1,
    phase: Math.random() * Math.PI * 2,
    cx,
    cy,
    angle,
    spin,
    hue: ((hue % 360) + 360) % 360,
    span: 0.55 + Math.random() * 0.45,
    r0: Math.min(w, h) * (0.22 + Math.random() * 0.35),
    r1: Math.random() * 0.8,
  })
}

function drawLasers(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lasers: Laser[],
  vMix: number,
  lowBand: number,
  midBand: number,
  highBand: number,
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const hyp = Math.hypot(w, h)

  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i]!
    const a = L.life * (0.35 + vMix * 0.55)
    const col = `hsla(${L.hue}, 100%, 62%, ${a})`
    const colCore = `hsla(${L.hue}, 95%, 88%, ${a * 0.9})`
    ctx.strokeStyle = col
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowBlur = 22 * L.life
    ctx.shadowColor = `hsla(${L.hue}, 100%, 55%, ${a * 0.5})`

    L.phase += 0.055 + midBand * 0.04 + highBand * 0.06
    const rot = L.angle + L.phase * L.spin

    switch (L.kind) {
      case 'sweep': {
        const len = hyp * 0.72 * L.span
        ctx.lineWidth = 2.2 + highBand * 2
        ctx.beginPath()
        ctx.moveTo(L.cx - Math.cos(rot) * len * 0.5, L.cy - Math.sin(rot) * len * 0.5)
        ctx.lineTo(L.cx + Math.cos(rot) * len * 0.5, L.cy + Math.sin(rot) * len * 0.5)
        ctx.stroke()
        ctx.strokeStyle = colCore
        ctx.lineWidth = 1
        ctx.stroke()
        break
      }
      case 'fan': {
        const rays = 9
        const spread = (0.55 + lowBand * 0.35 + Math.sin(L.phase) * 0.12) * L.span
        ctx.lineWidth = 1.4 + vMix
        for (let r = 0; r < rays; r++) {
          const t = rot + (r / (rays - 1) - 0.5) * spread
          const len = hyp * (0.25 + (r % 3) * 0.06)
          ctx.beginPath()
          ctx.moveTo(L.cx, L.cy)
          ctx.lineTo(L.cx + Math.cos(t) * len, L.cy + Math.sin(t) * len)
          ctx.stroke()
        }
        break
      }
      case 'slash': {
        const y = (L.r1 + L.phase * 0.12) % 1
        const yp = y * h
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(-40, yp + Math.sin(L.phase * 3) * 40)
        ctx.lineTo(w + 40, yp + Math.cos(L.phase * 2.2) * 60)
        ctx.stroke()
        ctx.strokeStyle = colCore
        ctx.lineWidth = 1
        ctx.stroke()
        break
      }
      case 'helix': {
        const segs = 48
        const r = L.r0 * (0.4 + L.life * 0.6)
        ctx.lineWidth = 1.6
        ctx.beginPath()
        for (let s = 0; s <= segs; s++) {
          const u = s / segs
          const ang = rot + u * Math.PI * 5 + L.phase * 2
          const rr = r * (0.35 + u * 0.65)
          const x = L.cx + Math.cos(ang) * rr
          const y = L.cy + Math.sin(ang * 1.7) * rr * 0.42
          if (s === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        break
      }
      case 'orbit': {
        const n = 6
        ctx.lineWidth = 1.3
        for (let k = 0; k < n; k++) {
          const ang = rot + (k / n) * Math.PI * 2 + L.phase
          const x1 = L.cx + Math.cos(ang) * L.r0 * 0.2
          const y1 = L.cy + Math.sin(ang) * L.r0 * 0.2
          const x2 = L.cx + Math.cos(ang) * L.r0 * 1.1
          const y2 = L.cy + Math.sin(ang) * L.r0 * 1.1
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
        }
        break
      }
      default:
        break
    }

    L.life -= 0.012 + (1 - vMix) * 0.008
    if (L.life <= 0) lasers.splice(i, 1)
  }

  ctx.shadowBlur = 0
  ctx.restore()
}

export function startReactiveViz(
  analyser: AnalyserNode,
  canvas: HTMLCanvasElement,
  getUi?: () => VizUiSnapshot,
): () => void {
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) {
    return () => {}
  }
  const ctx = ctx2d

  const freq = new Uint8Array(analyser.frequencyBinCount)
  const time = new Uint8Array(analyser.fftSize)
  let raf = 0
  let rmsSmooth = 0
  let prevBassNorm = 0
  let prevBandEnergy = 0
  let strobe = 0
  let strobeSharp = 0
  const lasers: Laser[] = []

  function defaultUi(): VizUiSnapshot {
    return { volA: 1, volB: 1, crossfader: 0.5, eqLow: 0, eqMid: 0, eqHigh: 0 }
  }

  function mixVol(ui: VizUiSnapshot): number {
    const xf = Math.max(0, Math.min(1, ui.crossfader))
    return Math.max(0.08, Math.min(1, ui.volA * (1 - xf) + ui.volB * xf))
  }

  function resize(): void {
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(window.innerWidth * dpr)
    canvas.height = Math.floor(window.innerHeight * dpr)
    canvas.style.width = `${window.innerWidth}px`
    canvas.style.height = `${window.innerHeight}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function draw(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const ui = getUi?.() ?? defaultUi()
    const vMix = mixVol(ui)

    analyser.getByteFrequencyData(freq)
    analyser.getByteTimeDomainData(time)

    let sum = 0
    for (let i = 0; i < time.length; i++) {
      const v = (time[i]! - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / time.length)

    const fl = freq.length
    const iLo1 = Math.max(2, Math.floor(fl * 0.08))
    const iMid1 = Math.floor(fl * 0.45)
    let low = 0
    let mid = 0
    let high = 0
    for (let i = 0; i < iLo1; i++) low += freq[i]!
    low /= Math.max(1, iLo1) * 255
    for (let i = iLo1; i < iMid1; i++) mid += freq[i]!
    mid /= Math.max(1, iMid1 - iLo1) * 255
    for (let i = iMid1; i < fl; i++) high += freq[i]!
    high /= Math.max(1, fl - iMid1) * 255

    const bandEnergy = low * 0.45 + mid * 0.35 + high * 0.2
    const flux = Math.max(0, bandEnergy - prevBandEnergy)
    prevBandEnergy = prevBandEnergy * 0.9 + bandEnergy * 0.1

    rmsSmooth = rmsSmooth * 0.85 + rms * 0.15

    const bassKick = Math.max(0, low - prevBassNorm - 0.038) * 6
    prevBassNorm = prevBassNorm * 0.9 + low * 0.1

    const musicDrive = (flux * 1.4 + rmsSmooth * 0.35 + bassKick * 0.5) * vMix

    strobe = Math.min(0.92, strobe * 0.84 + musicDrive * 0.42)
    if (bassKick > 0.18) {
      strobeSharp = Math.min(1, strobeSharp + bassKick * (0.55 + vMix * 0.45))
    }
    strobeSharp *= 0.78

    const fade = Math.min(0.55, 0.22 + (1 - vMix) * 0.12 + rmsSmooth * 0.08)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = `rgba(0, 0, 0, ${fade})`
    ctx.fillRect(0, 0, w, h)

    spawnLaser(w, h, low, mid, high, flux, bassKick, vMix, lasers)
    drawLasers(ctx, w, h, lasers, vMix, low, mid, high)

    const eqBoost = 1 + Math.max(0, ui.eqHigh) / 24 * 0.12
    const strobeAlpha = strobe * (0.12 + vMix * 0.32) * eqBoost
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = `rgba(255, 40, 48, ${strobeAlpha})`
    ctx.fillRect(0, 0, w, h)

    if (strobeSharp > 0.04) {
      const a = strobeSharp * (0.14 + vMix * 0.42)
      ctx.fillStyle = `rgba(255, 160, 150, ${a * 0.55})`
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = `rgba(255, 90, 95, ${a * 0.35})`
      ctx.fillRect(0, 0, w, h)
    }

    ctx.globalCompositeOperation = 'source-over'

    raf = requestAnimationFrame(draw)
  }

  resize()
  window.addEventListener('resize', resize)
  raf = requestAnimationFrame(draw)

  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
  }
}
