/** Single-buffer deck: decode once, 3-band EQ, play/pause; output to mixer bus. */
export class Deck {
  private readonly context: AudioContext
  private readonly lowShelf: BiquadFilterNode
  private readonly midPeak: BiquadFilterNode
  private readonly highShelf: BiquadFilterNode
  private readonly trim: GainNode
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private playStartCtxTime = 0
  private offsetSec = 0
  private playing = false
  /** Musical tempo vs file: 1 = analyzed BPM; lower = slower, higher = faster. */
  private playbackRateValue = 1
  /** Temporary vinyl-style nudge (1 = neutral). Multiplied with playbackRateValue on the buffer source. */
  private jogTempoMultiplier = 1

  constructor(context: AudioContext, bus: AudioNode) {
    this.context = context
    this.lowShelf = context.createBiquadFilter()
    this.midPeak = context.createBiquadFilter()
    this.highShelf = context.createBiquadFilter()
    this.trim = context.createGain()

    this.lowShelf.type = 'lowshelf'
    this.lowShelf.frequency.value = 280
    this.lowShelf.gain.value = 0

    this.midPeak.type = 'peaking'
    this.midPeak.frequency.value = 1200
    this.midPeak.Q.value = 1.05
    this.midPeak.gain.value = 0

    this.highShelf.type = 'highshelf'
    this.highShelf.frequency.value = 3200
    this.highShelf.gain.value = 0

    this.trim.gain.value = 1

    this.lowShelf.connect(this.midPeak)
    this.midPeak.connect(this.highShelf)
    this.highShelf.connect(this.trim)
    this.trim.connect(bus)
  }

  /** -12 … +12 dB */
  setEqLow(db: number): void {
    this.lowShelf.gain.value = Math.max(-12, Math.min(12, db))
  }

  setEqMid(db: number): void {
    this.midPeak.gain.value = Math.max(-12, Math.min(12, db))
  }

  setEqHigh(db: number): void {
    this.highShelf.gain.value = Math.max(-12, Math.min(12, db))
  }

  get duration(): number {
    return this.buffer?.duration ?? 0
  }

  get isPlaying(): boolean {
    return this.playing
  }

  getPlaybackRate(): number {
    return this.playbackRateValue
  }

  private effectiveSourceRate(): number {
    return Math.max(0.01, this.playbackRateValue * this.jogTempoMultiplier)
  }

  /**
   * Web Audio: `computedPlaybackRate = playbackRate * 2^(detune/1200)` — both params scale
   * **speed together**. Pitch-shifting via `detune` does **not** undo tempo; matching
   * `-1200*log2(r)` to `playbackRate = r` would cancel tempo entirely (~1× always).
   */
  private applySourceRateAndDetune(src: AudioBufferSourceNode): void {
    const eff = this.effectiveSourceRate()
    src.playbackRate.value = eff
    src.detune.value = 0
  }

  /** Snap timeline so `getCurrentTime()` stays correct after a rate/jog change while playing. */
  private commitTimelineAtNow(): void {
    if (!this.buffer || !this.playing) return
    const t = Math.min(this.getCurrentTime(), this.buffer.duration)
    this.offsetSec = t
    this.playStartCtxTime = this.context.currentTime
  }

  /** Clamped ~±12%. Resets temporary jog. Tempo follows rate (pitch follows — no single-node key lock). */
  setPlaybackRate(rate: number): void {
    const r = Math.max(0.88, Math.min(1.12, rate))
    if (this.playing && this.source) {
      this.commitTimelineAtNow()
    }
    this.playbackRateValue = r
    this.jogTempoMultiplier = 1
    if (this.source) {
      this.applySourceRateAndDetune(this.source)
    }
  }

  /** Temporary vinyl jog: ~0.92…1.08 on top of deck tempo. Does not change stored tempo match rate. */
  setJogTempoMultiplier(mult: number): void {
    if (this.playing && this.source) {
      this.commitTimelineAtNow()
    }
    this.jogTempoMultiplier = Math.max(0.92, Math.min(1.08, mult))
    if (this.source) {
      this.applySourceRateAndDetune(this.source)
    }
  }

  resetJogTempoMultiplier(): void {
    if (this.playing && this.source) {
      this.commitTimelineAtNow()
    }
    this.jogTempoMultiplier = 1
    if (this.source) {
      this.applySourceRateAndDetune(this.source)
    }
  }

  getCurrentTime(): number {
    if (!this.buffer) return 0
    if (!this.playing) return Math.min(this.offsetSec, this.buffer.duration)
    const wall = this.context.currentTime - this.playStartCtxTime
    const advanced = wall * this.effectiveSourceRate()
    return Math.min(this.offsetSec + advanced, this.buffer.duration)
  }

  seekTo(sec: number): void {
    if (!this.buffer) return
    const t = Math.max(0, Math.min(sec, this.buffer.duration))
    if (this.playing && this.source) {
      try {
        this.source.stop()
      } catch {
        /* already stopped */
      }
      this.source.disconnect()
      this.source = null
      this.playing = false
      this.offsetSec = t
      void this.play()
      return
    }
    this.offsetSec = t
  }

  nudgePlayhead(deltaSec: number): void {
    this.seekTo(this.getCurrentTime() + deltaSec)
  }

  async resume(): Promise<void> {
    if (this.context.state === 'suspended') {
      await this.context.resume()
    }
  }

  async loadFile(file: File): Promise<AudioBuffer> {
    await this.resume()
    this.stopPlayback()
    const raw = await file.arrayBuffer()
    this.buffer = await this.context.decodeAudioData(raw.slice(0))
    this.offsetSec = 0
    this.playbackRateValue = 1
    this.jogTempoMultiplier = 1
    return this.buffer
  }

  async play(): Promise<void> {
    await this.resume()
    if (!this.buffer) return
    if (this.playing) return

    const src = this.context.createBufferSource()
    src.buffer = this.buffer
    this.applySourceRateAndDetune(src)
    src.connect(this.lowShelf)

    this.playStartCtxTime = this.context.currentTime
    src.addEventListener('ended', () => {
      if (this.source !== src) return
      this.playing = false
      this.offsetSec = this.buffer?.duration ?? 0
      this.source = null
    })

    this.source = src
    this.playing = true
    src.start(0, this.offsetSec)
  }

  pause(): void {
    if (!this.buffer || !this.playing || !this.source) return
    const wall = this.context.currentTime - this.playStartCtxTime
    const advanced = wall * this.effectiveSourceRate()
    this.offsetSec = Math.min(this.offsetSec + advanced, this.buffer.duration)
    try {
      this.source.stop()
    } catch {
      /* already stopped */
    }
    this.source.disconnect()
    this.source = null
    this.playing = false
  }

  private stopPlayback(): void {
    if (this.source) {
      try {
        this.source.stop()
      } catch {
        /* already stopped */
      }
      this.source.disconnect()
      this.source = null
    }
    this.playing = false
  }
}
