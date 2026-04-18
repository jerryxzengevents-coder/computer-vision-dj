/** Full-screen canvas driven by master-bus AnalyserNode (frequency + RMS). */

export function startReactiveViz(
  analyser: AnalyserNode,
  canvas: HTMLCanvasElement,
): () => void {
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) {
    return () => {}
  }
  const ctx = ctx2d

  const freq = new Uint8Array(analyser.frequencyBinCount)
  const time = new Uint8Array(analyser.fftSize)
  let raf = 0
  let phase = 0
  let bassSmooth = 0
  let rmsSmooth = 0

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
    analyser.getByteFrequencyData(freq)
    analyser.getByteTimeDomainData(time)

    let sum = 0
    for (let i = 0; i < time.length; i++) {
      const v = (time[i]! - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / time.length)

    let bass = 0
    const nBass = Math.max(4, Math.floor(freq.length * 0.07))
    for (let i = 0; i < nBass; i++) bass += freq[i]!
    bass /= nBass * 255

    bassSmooth = bassSmooth * 0.9 + bass * 0.1
    rmsSmooth = rmsSmooth * 0.85 + rms * 0.15
    phase += 0.012 + bassSmooth * 0.06 + rmsSmooth * 0.04

    const g = ctx.createLinearGradient(0, 0, w, h * 1.2)
    const hue1 = (232 + phase * 35 + bassSmooth * 50) % 360
    const hue2 = (295 + bassSmooth * 70 + rmsSmooth * 40) % 360
    g.addColorStop(0, `hsla(${hue1}, 58%, 9%, 1)`)
    g.addColorStop(0.55, `hsla(${hue2}, 45%, 7%, 1)`)
    g.addColorStop(1, `hsla(${hue1 + 40}, 50%, 5%, 1)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    const bars = 72
    const step = Math.max(1, Math.floor(freq.length / bars))
    const halfW = w * 0.42
    const cx = w * 0.5
    const baseY = h - 28
    for (let i = 0; i < bars; i++) {
      let v = 0
      for (let j = 0; j < step; j++) v += freq[Math.min(freq.length - 1, i * step + j)]!
      v /= step * 255
      const bh = (0.04 + v * v) * h * 0.38
      const bw = halfW / bars - 0.5
      const hue = 255 + (i / bars) * 60 + bassSmooth * 40
      const alpha = 0.12 + v * 0.55
      ctx.fillStyle = `hsla(${hue}, 85%, 62%, ${alpha})`
      const offset = (i / bars) * halfW
      ctx.fillRect(cx + offset, baseY - bh, bw, bh)
      ctx.fillRect(cx - offset - bw, baseY - bh, bw, bh)
    }

    const orbs = [
      { x: 0.22, y: 0.32, hue: 310 },
      { x: 0.5, y: 0.28, hue: 265 },
      { x: 0.78, y: 0.36, hue: 195 },
    ]
    for (let k = 0; k < orbs.length; k++) {
      const o = orbs[k]!
      const ox = w * o.x + Math.sin(phase * 1.1 + k * 1.7) * (50 + rmsSmooth * 120)
      const oy = h * o.y + Math.cos(phase * 0.85 + k) * (35 + bassSmooth * 80)
      const rad = 90 + bassSmooth * 220 + k * 30
      const grd = ctx.createRadialGradient(ox, oy, 0, ox, oy, rad)
      const a0 = 0.06 + bassSmooth * 0.22 + rmsSmooth * 0.12
      grd.addColorStop(0, `hsla(${o.hue}, 92%, 58%, ${a0})`)
      grd.addColorStop(0.45, `hsla(${o.hue + 25}, 70%, 45%, ${a0 * 0.35})`)
      grd.addColorStop(1, 'transparent')
      ctx.fillStyle = grd
      ctx.fillRect(0, 0, w, h)
    }

    ctx.strokeStyle = `hsla(270, 40%, 70%, ${0.04 + rmsSmooth * 0.15})`
    ctx.lineWidth = 1
    const rings = 5
    for (let r = 0; r < rings; r++) {
      const t = (r / rings + phase * 0.03) % 1
      const radius = 80 + t * Math.min(w, h) * 0.55 + bassSmooth * 100
      ctx.beginPath()
      ctx.arc(cx, h * 0.52, radius, 0, Math.PI * 2)
      ctx.stroke()
    }

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
