/** Constant-power crossfade: t=0 → deck A, t=1 → deck B. */
export function crossfaderGains(t: number): { gainA: number; gainB: number } {
  const u = Math.max(0, Math.min(1, t))
  return {
    gainA: Math.cos(u * Math.PI * 0.5),
    gainB: Math.sin(u * Math.PI * 0.5),
  }
}

export type MixerGraph = {
  readonly context: AudioContext
  readonly channelGainA: GainNode
  readonly channelGainB: GainNode
  readonly xfGainA: GainNode
  readonly xfGainB: GainNode
  readonly masterGain: GainNode
  /** Taps post-crossfade mix for visuals (FFT / waveform). */
  readonly analyser: AnalyserNode
  setCrossfader(t: number): void
  getCrossfader: () => number
  setChannelVolume: (deck: 'A' | 'B', level: number) => void
  getChannelVolume: (deck: 'A' | 'B') => number
}

/** channel → crossfade → master → destination (+ analyser tap) */
export function createMixer(): MixerGraph {
  const context = new AudioContext()
  const channelGainA = context.createGain()
  const channelGainB = context.createGain()
  const xfGainA = context.createGain()
  const xfGainB = context.createGain()
  const masterGain = context.createGain()
  const analyser = context.createAnalyser()

  channelGainA.gain.value = 1
  channelGainB.gain.value = 1
  masterGain.gain.value = 1
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.82

  channelGainA.connect(xfGainA)
  channelGainB.connect(xfGainB)
  xfGainA.connect(masterGain)
  xfGainB.connect(masterGain)
  masterGain.connect(analyser)
  masterGain.connect(context.destination)

  let crossfaderT = 0.5

  const setCrossfader = (t: number): void => {
    crossfaderT = Math.max(0, Math.min(1, t))
    const { gainA, gainB } = crossfaderGains(crossfaderT)
    xfGainA.gain.value = gainA
    xfGainB.gain.value = gainB
  }

  const getCrossfader = (): number => crossfaderT

  const setChannelVolume = (deck: 'A' | 'B', level: number): void => {
    const v = Math.max(0, Math.min(1, level))
    if (deck === 'A') channelGainA.gain.value = v
    else channelGainB.gain.value = v
  }

  const getChannelVolume = (deck: 'A' | 'B'): number =>
    deck === 'A' ? channelGainA.gain.value : channelGainB.gain.value

  setCrossfader(0.5)

  return {
    context,
    channelGainA,
    channelGainB,
    xfGainA,
    xfGainB,
    masterGain,
    analyser,
    setCrossfader,
    getCrossfader,
    setChannelVolume,
    getChannelVolume,
  }
}
