/**
 * Tiny WebAudio synth: grab / thud / splash. Muted by default; M toggles.
 * No asset files — oscillator + noise bursts only.
 */

export interface AudioHandle {
  muted: () => boolean
  toggle: () => void
  grab: () => void
  thud: (impulse: number) => void
  splash: (impulse: number) => void
  dispose: () => void
}

export function createAudio(): AudioHandle {
  let muted = true
  let ctx: AudioContext | null = null

  const ensure = (): AudioContext | null => {
    if (muted) return null
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }

  const noise = (audio: AudioContext, dur: number): AudioBufferSourceNode => {
    const n = Math.max(1, Math.floor(audio.sampleRate * dur))
    const buf = audio.createBuffer(1, n, audio.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
    const src = audio.createBufferSource()
    src.buffer = buf
    return src
  }

  const burst = (
    kind: 'grab' | 'thud' | 'splash',
    mag: number,
  ) => {
    const audio = ensure()
    if (!audio) return
    const t = audio.currentTime
    const gain = audio.createGain()
    gain.connect(audio.destination)
    if (kind === 'grab') {
      const osc = audio.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(180, t)
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.08)
      gain.gain.setValueAtTime(0.08, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
      osc.connect(gain)
      osc.start(t)
      osc.stop(t + 0.12)
    } else if (kind === 'thud') {
      const amp = Math.min(0.22, 0.04 + mag / 4000)
      const src = noise(audio, 0.18)
      const filt = audio.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = 180 + Math.min(400, mag * 0.2)
      gain.gain.setValueAtTime(amp, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
      src.connect(filt)
      filt.connect(gain)
      src.start(t)
      src.stop(t + 0.18)
    } else {
      const amp = Math.min(0.2, 0.05 + mag / 3500)
      const src = noise(audio, 0.28)
      const filt = audio.createBiquadFilter()
      filt.type = 'bandpass'
      filt.frequency.value = 900
      filt.Q.value = 0.7
      gain.gain.setValueAtTime(amp, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26)
      src.connect(filt)
      filt.connect(gain)
      src.start(t)
      src.stop(t + 0.28)
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey) {
      muted = !muted
      if (!muted) ensure()
    }
  }
  window.addEventListener('keydown', onKey)

  return {
    muted: () => muted,
    toggle: () => {
      muted = !muted
      if (!muted) ensure()
    },
    grab: () => burst('grab', 1),
    thud: (impulse: number) => burst('thud', impulse),
    splash: (impulse: number) => burst('splash', impulse),
    dispose: () => {
      window.removeEventListener('keydown', onKey)
      void ctx?.close()
      ctx = null
    },
  }
}
