import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import './App.css'

type Feel = 'crystal' | 'warm' | 'electro' | 'void'
interface ColorData { hex: string; hue: number }

const COLORS: ColorData[] = [
  { hex: '#5ba4d8', hue: 205 }, { hex: '#e88aaa', hue: 340 },
  { hex: '#6abf8a', hue: 145 }, { hex: '#e89050', hue: 28 },
  { hex: '#c8d8f0', hue: 215 }, { hex: '#9a72c8', hue: 268 },
  { hex: '#d4c050', hue: 52  }, { hex: '#7899b0', hue: 205 },
]

const FEEL_PRESETS = {
  crystal: { padType: 'sine',     padVolume: -10, arpType: 'triangle', arpVolume: -8,  bassType: 'sawtooth', bassVolume: -22, reverbDecay: 5, reverbWet: 0.65, filterFreq: 3500, delayTime: '8n',  delayFeedback: 0.25, arpSpeed: '8n'  },
  warm:    { padType: 'triangle', padVolume: -9,  arpType: 'sine',     arpVolume: -12, bassType: 'triangle', bassVolume: -18, reverbDecay: 4, reverbWet: 0.5,  filterFreq: 1800, delayTime: '4n',  delayFeedback: 0.2,  arpSpeed: '4n.' },
  electro: { padType: 'sawtooth', padVolume: -14, arpType: 'square',   arpVolume: -10, bassType: 'sawtooth', bassVolume: -16, reverbDecay: 3, reverbWet: 0.4,  filterFreq: 2400, delayTime: '8n.', delayFeedback: 0.35, arpSpeed: '16n' },
  void:    { padType: 'sine',     padVolume: -8,  arpType: 'sine',     arpVolume: -16, bassType: 'sine',     bassVolume: -24, reverbDecay: 9, reverbWet: 0.8,  filterFreq: 900,  delayTime: '2n',  delayFeedback: 0.45, arpSpeed: '4n.' },
} as const

const MINOR_NOTES = ['A3','C4','D4','E4','G4','A4','C5','D5','E5','G5']
const MAJOR_NOTES = ['A3','C#4','E4','F#4','A4','C#5','E5','F#5','A5']
const BASS_MINOR  = ['A2','E2','D2','G2']
const BASS_MAJOR  = ['A2','E2','C#2','F#2']

function getFinalMessage(w: number) {
  if (w <= 3) return 'その重さも、\n大切な一部になった。'
  if (w <= 6) return 'ゆっくりでいい。\nそれでも、あなたの世界は動いている。'
  return '重いほど、\n音が救ってくれる。'
}

type Screen = 'weight' | 'feel' | 'color' | 'canvas' | 'end'

export default function App() {
  const [screen, setScreen] = useState<Screen>('weight')
  const [weight, setWeight] = useState(5)
  const [feel, setFeel]     = useState<Feel | null>(null)
  const [color, setColor]   = useState<ColorData | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [finalMsg, setFinalMsg] = useState('')

  const masterGainRef = useRef<Tone.Gain | null>(null)
  const padRef        = useRef<Tone.PolySynth | null>(null)
  const arpRef        = useRef<Tone.PolySynth | null>(null)
  const bassRef       = useRef<Tone.MonoSynth | null>(null)
  const bellRef       = useRef<Tone.MetalSynth | null>(null)
  const filtRef       = useRef<Tone.Filter | null>(null)
  const arpPatRef     = useRef<Tone.Pattern<string> | null>(null)
  const padIntRef     = useRef<number | null>(null)
  const bassIntRef    = useRef<number | null>(null)
  const synthPlayingRef = useRef(false)
  const micStreamRef   = useRef<MediaStream | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const micArrayRef    = useRef<Uint8Array | null>(null)
  const micFrameRef    = useRef<number | null>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const ctx2dRef    = useRef<CanvasRenderingContext2D | null>(null)
  const isDrawing   = useRef(false)
  const lastPos     = useRef({ x: 0, y: 0 })
  const strokeCount = useRef(0)
  const brushHue    = useRef(200)

  function getTempo() { return Math.round(60 + (weight - 1) * (35 / 9)) }

  async function initAudio() {
    await Tone.start()
    Tone.getTransport().bpm.value = getTempo()
    const preset = FEEL_PRESETS[feel ?? 'electro']
    const limiter  = new Tone.Limiter(-2).toDestination()
    const reverb   = new Tone.Reverb({ decay: preset.reverbDecay, wet: preset.reverbWet }).connect(limiter)
    const delay    = new Tone.FeedbackDelay(preset.delayTime as Tone.Unit.Time, preset.delayFeedback).connect(reverb)
    const gain     = new Tone.Gain(1).connect(delay)
    const filt     = new Tone.Filter(preset.filterFreq, 'lowpass', -24).connect(gain)
    masterGainRef.current = gain
    filtRef.current       = filt
    padRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: preset.padType as OscillatorType },
      envelope:   { attack: 1.2, decay: 0.5, sustain: 0.8, release: 3 },
      volume:     preset.padVolume,
    }).connect(filt)
    arpRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: preset.arpType as OscillatorType },
      envelope:   { attack: 0.01, decay: 0.3, sustain: 0.1, release: 1.2 },
      volume:     preset.arpVolume,
    }).connect(filt)
    bassRef.current = new Tone.MonoSynth({
      oscillator:     { type: preset.bassType as OscillatorType },
      envelope:       { attack: 0.05, decay: 0.4, sustain: 0.6, release: 1 },
      filterEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.5, release: 1, baseFrequency: 120, octaves: 2 },
      volume:         preset.bassVolume,
    }).connect(limiter)
    bellRef.current = new Tone.MetalSynth({
      frequency: 400, envelope: { attack: 0.001, decay: 1.4, release: 0.2 },
      harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, volume: -28,
    }).connect(reverb)
  }

  function startMusic(major = false) {
    if (synthPlayingRef.current) return
    synthPlayingRef.current = true
    const notes     = major ? MAJOR_NOTES : MINOR_NOTES
    const bassNotes = major ? BASS_MAJOR  : BASS_MINOR
    function playPad() {
      if (isMuted || !padRef.current) return
      padRef.current.triggerAttackRelease(
        [notes[Math.floor(Math.random() * 5)], notes[Math.floor(Math.random() * 5) + 4]],
        major ? '1m' : '2n.'
      )
    }
    playPad()
    padIntRef.current = window.setInterval(playPad, Tone.Time('1m').toMilliseconds())
    let bassIdx = 0
    function playBass() {
      if (isMuted || !bassRef.current) return
      bassRef.current.triggerAttackRelease(bassNotes[bassIdx % bassNotes.length], '8n')
      bassIdx++
    }
    playBass()
    bassIntRef.current = window.setInterval(playBass, Tone.Time('4n').toMilliseconds())
    const preset = FEEL_PRESETS[feel ?? 'electro']
    const pat = new Tone.Pattern<string>((time, note) => {
      if (isMuted || !arpRef.current) return
      arpRef.current.triggerAttackRelease(note, '16n', time, 0.5 + Math.random() * 0.3)
    }, notes, 'upDown')
    pat.interval = preset.arpSpeed as Tone.Unit.Time
    pat.start(0)
    arpPatRef.current = pat
    Tone.getTransport().start()
  }

  function stopMusic() {
    if (padIntRef.current)  clearInterval(padIntRef.current)
    if (bassIntRef.current) clearInterval(bassIntRef.current)
    if (arpPatRef.current)  { arpPatRef.current.stop(); arpPatRef.current.dispose(); arpPatRef.current = null }
    padRef.current?.releaseAll()
    bassRef.current?.triggerRelease()
    Tone.getTransport().stop()
    synthPlayingRef.current = false
  }

  async function transitionToMajor() {
    if (padIntRef.current)  clearInterval(padIntRef.current)
    if (bassIntRef.current) clearInterval(bassIntRef.current)
    if (arpPatRef.current)  { arpPatRef.current.stop(); arpPatRef.current.dispose(); arpPatRef.current = null }
    if (!isMuted) {
      filtRef.current?.frequency.rampTo(6000, 2.5)
      padRef.current?.triggerAttackRelease(['A3','C#4','E4','A4','E5'], '1m')
      bassRef.current?.triggerAttackRelease('A2', '2n')
      setTimeout(() => bellRef.current?.triggerAttackRelease('8n'), 800)
      setTimeout(() => bellRef.current?.triggerAttackRelease('8n'), 1400)
      setTimeout(() => bellRef.current?.triggerAttackRelease('8n'), 2000)
      await new Promise(r => setTimeout(r, 3500))
    }
    stopMusic()
  }

  function handleMute() {
    const next = !isMuted
    setIsMuted(next)
    masterGainRef.current?.gain.rampTo(next ? 0 : 1, 0.3)
  }

  async function startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      const raw = Tone.getContext().rawContext as AudioContext
      const src = raw.createMediaStreamSource(stream)
      const analyser = raw.createAnalyser()
      analyser.fftSize = 256
      micAnalyserRef.current = analyser
      micArrayRef.current = new Uint8Array(analyser.frequencyBinCount)
      src.connect(analyser)
      monitorMic()
    } catch { console.log('mic not available') }
  }

  function monitorMic() {
    const ring = document.getElementById('mic-ring')
    function tick() {
      micFrameRef.current = requestAnimationFrame(tick)
      if (!micAnalyserRef.current || !micArrayRef.current || isMuted) return
      micAnalyserRef.current.getByteFrequencyData(micArrayRef.current)
      const avg   = micArrayRef.current.reduce((a, b) => a + b, 0) / micArrayRef.current.length
      const level = avg / 128
      if (level > 0.06 && filtRef.current) {
        filtRef.current.frequency.rampTo(1200 + level * 5000, 0.08)
        ring?.classList.add('active')
        if (ring) ring.style.transform = `translateX(-50%) scale(${1 + level})`
      } else {
        ring?.classList.remove('active')
        if (ring) ring.style.transform = 'translateX(-50%) scale(1)'
      }
    }
    tick()
  }

  function stopMic() {
    if (micFrameRef.current) cancelAnimationFrame(micFrameRef.current)
    micStreamRef.current?.getTracks().forEach(t => t.stop())
  }

  function initCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx2dRef.current = ctx
    ctx.fillStyle = '#06080f'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    brushHue.current = color?.hue ?? 200
  }

  function getPos(e: MouseEvent | TouchEvent) {
    if ('touches' in e) return { x: e.touches[0].clientX, y: e.touches[0].clientY }
    return { x: e.clientX, y: e.clientY }
  }

  function spawnParticle(x: number, y: number) {
    const p = document.createElement('div')
    p.className = 'particle'
    const size = 3 + Math.random() * 9
    p.style.cssText = `left:${x-size/2}px;top:${y-size/2}px;width:${size}px;height:${size}px;background:hsla(${brushHue.current},85%,72%,0.8);animation-duration:${1+Math.random()*1.2}s;`
    document.getElementById('particles')?.appendChild(p)
    setTimeout(() => p.remove(), 2300)
  }

  useEffect(() => {
    if (screen !== 'canvas') return
    const canvas = canvasRef.current
    if (!canvas) return
    const onStart = (e: MouseEvent | TouchEvent) => {
      e.preventDefault(); isDrawing.current = true
      const { x, y } = getPos(e); lastPos.current = { x, y }
    }
    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      if (!isDrawing.current || !ctx2dRef.current) return
      const { x, y } = getPos(e)
      const dx = x - lastPos.current.x, dy = y - lastPos.current.y
      const speed = Math.sqrt(dx*dx + dy*dy)
      const lightness = Math.min(78, 38 + speed * 1.1)
      const alpha = Math.min(0.92, 0.35 + speed * 0.018)
      const ctx = ctx2dRef.current
      ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(x, y)
      ctx.strokeStyle = `hsla(${brushHue.current},75%,${lightness}%,${alpha})`
      ctx.lineWidth = Math.min(22, 3 + speed * 0.4); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke()
      ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(x, y)
      ctx.strokeStyle = `hsla(${brushHue.current},90%,80%,${alpha*0.18})`
      ctx.lineWidth = Math.min(40, 8 + speed * 0.8); ctx.stroke()
      lastPos.current = { x, y }; strokeCount.current++
      if (!isMuted && speed > 8 && arpRef.current && strokeCount.current % 6 === 0) {
        arpRef.current.triggerAttackRelease(MINOR_NOTES[Math.floor(Math.random()*MINOR_NOTES.length)], '16n', undefined, 0.4)
      }
      if (Math.random() < 0.1) spawnParticle(x, y)
    }
    const onEnd = () => { isDrawing.current = false }
    canvas.addEventListener('mousedown', onStart)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseup', onEnd)
    canvas.addEventListener('mouseleave', onEnd)
    canvas.addEventListener('touchstart', onStart, { passive: false })
    canvas.addEventListener('touchmove', onMove, { passive: false })
    canvas.addEventListener('touchend', onEnd)
    return () => {
      canvas.removeEventListener('mousedown', onStart)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseup', onEnd)
      canvas.removeEventListener('mouseleave', onEnd)
      canvas.removeEventListener('touchstart', onStart)
      canvas.removeEventListener('touchmove', onMove)
      canvas.removeEventListener('touchend', onEnd)
    }
  }, [screen, isMuted])

  async function goToCanvas() {
    setScreen('canvas')
    await initAudio()
    setTimeout(() => { initCanvas(); startMusic(false) }, 100)
    await startMic()
  }

  async function handleDone() {
    stopMic(); await transitionToMajor()
    setFinalMsg(getFinalMessage(weight)); setScreen('end')
  }

  function handleRestart() {
    setScreen('weight'); setWeight(5); setFeel(null); setColor(null)
    setIsMuted(false); strokeCount.current = 0; synthPlayingRef.current = false
    document.getElementById('particles')!.innerHTML = ''
  }

  return (
    <>
      {screen === 'canvas' && (
        <button className={`mute-btn ${isMuted ? 'muted' : ''}`} onClick={handleMute}>♪</button>
      )}
      {screen === 'weight' && (
        <div className="screen">
          <h1>今の自分の<br />重さを教えてください</h1>
          <p className="sub">how heavy do you feel today</p>
          <div className="weight-display" style={{ color: `hsl(${200+weight*5},70%,68%)`, textShadow: `0 0 40px hsla(${200+weight*5},70%,68%,0.5)` }}>{weight}</div>
          <input type="range" min={1} max={10} value={weight} onChange={e => setWeight(Number(e.target.value))} />
          <button className="next-btn" onClick={() => setScreen('feel')}>次へ</button>
        </div>
      )}
      {screen === 'feel' && (
        <div className="screen">
          <h2>音の質感は？</h2>
          <p className="sub">choose your sound texture</p>
          <div className="feel-grid">
            {([
              { key: 'crystal', icon: '✦', ja: 'クリスタル', en: 'crystal' },
              { key: 'warm',    icon: '◎', ja: '温かい',     en: 'warm'    },
              { key: 'electro', icon: '⚡', ja: 'エレクトロ', en: 'electro' },
              { key: 'void',    icon: '◈', ja: '空間的',     en: 'void'    },
            ] as const).map(f => (
              <div key={f.key} className={`feel-card ${feel===f.key?'selected':''}`} onClick={() => setFeel(f.key)}>
                <div className="feel-icon">{f.icon}</div>
                <div className="feel-name">{f.ja}<br />{f.en}</div>
              </div>
            ))}
          </div>
          <button className="next-btn" disabled={!feel} onClick={() => setScreen('color')}>次へ</button>
        </div>
      )}
      {screen === 'color' && (
        <div className="screen">
          <h2>今の色を選んでください</h2>
          <p className="sub">choose the color of today</p>
          <div className="color-grid">
            {COLORS.map((c, i) => (
              <div key={i} className={`color-swatch ${color?.hex===c.hex?'selected':''}`}
                style={{ background: c.hex, boxShadow: color?.hex===c.hex?`0 0 22px ${c.hex}`:undefined }}
                onClick={() => setColor(c)} />
            ))}
          </div>
          <button className="next-btn" disabled={!color} onClick={goToCanvas}>次へ</button>
        </div>
      )}
      {screen === 'canvas' && (
        <div className="screen-canvas">
          <canvas ref={canvasRef} className="drawing-canvas" />
          <div className="canvas-ui">
            <p className="hint">画面に描いて　声も吹き込んで<br />draw · speak · breathe</p>
            <div id="mic-ring" />
            <button className="done-btn" onClick={handleDone}>完成させる</button>
          </div>
        </div>
      )}
      {screen === 'end' && (
        <div className="screen end-screen">
          <div className="final-message">{finalMsg}</div>
          <div className="final-sub"><br />you have already proved your value.</div>
          <button className="restart" onClick={handleRestart}>/again</button>
        </div>
      )}
      <div id="particles" />
    </>
  )
}
