'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Camera, Check, FileUp, Laptop, Lightbulb, Play, RotateCcw, ShieldAlert, Smartphone, Zap } from 'lucide-react'

const gridColors = ['#9DE8C2', '#F5C4B8', '#F8D56B', '#C9B8F2']

export default function Page() {
  const [mode, setMode] = useState<'send' | 'catch'>('send')
  const [beaming, setBeaming] = useState(false)
  const [progress, setProgress] = useState(0)
  const [file, setFile] = useState<File | null>(null)

  const grid = useMemo(() => Array.from({ length: 160 }, (_, index) => gridColors[(index * 7 + Math.floor(index / 8)) % gridColors.length]), [])

  function startBeam() {
    setBeaming(true)
    setProgress(0)
    let value = 0
    const timer = window.setInterval(() => {
      value += 4
      setProgress(value)
      if (value >= 100) {
        window.clearInterval(timer)
        setBeaming(false)
      }
    }, 120)
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-6 md:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><Lightbulb size={19} /></div>
          <div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Optical Data</p><p className="text-base font-bold tracking-tight">Bridge</p></div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold shadow-sm"><span className="h-2 w-2 animate-pulse rounded-full bg-mint" /> System Ready</div>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-14 md:px-8">
        <div className="mx-auto flex max-w-fit items-center gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-sm" role="tablist" aria-label="Bridge mode">
          <button onClick={() => setMode('send')} role="tab" aria-selected={mode === 'send'} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all active:scale-95 ${mode === 'send' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}><Laptop size={16} /> Send File</button>
          <button onClick={() => setMode('catch')} role="tab" aria-selected={mode === 'catch'} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all active:scale-95 ${mode === 'catch' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}><Smartphone size={16} /> Catch File</button>
        </div>

        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div>
            <AnimatePresence mode="wait">
              {mode === 'send' ? <motion.div key="send" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>
                <p className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.18em] text-coral">Laptop transmitter</p>
                <h1 className="max-w-xl text-balance text-5xl font-black leading-[0.98] tracking-[-0.06em] md:text-7xl">Send files through <span className="relative inline-block">light.<span className="absolute -bottom-1 left-1 right-0 h-3 -rotate-2 rounded-full bg-yellow/70" /></span></h1>
                <p className="mt-6 max-w-md text-pretty text-base leading-7 text-muted-foreground">A tiny, private light show for moving files from your screen to any phone camera. No cloud. No cables. Just color.</p>
                <label className="mt-8 flex cursor-pointer items-center gap-4 rounded-3xl border-2 border-dashed border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-muted">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow/40 text-primary"><FileUp size={22} /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{file ? file.name : 'Drop a file to start the light show.'}</span><span className="mt-1 block font-mono text-xs text-muted-foreground">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'or click to browse your laptop'}</span></span>
                  <input className="sr-only" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                </label>
                <button onClick={startBeam} disabled={beaming} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-bold text-primary-foreground shadow-[0_5px_0_hsl(var(--primary-shadow))] transition-all hover:-translate-y-0.5 active:translate-y-1 disabled:opacity-60"><Play size={17} fill="currentColor" /> {beaming ? 'Beaming...' : 'Start Beaming'} <Zap size={16} /></button>
              </motion.div> : <motion.div key="catch" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>
                <p className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.18em] text-mint-dark">Phone receiver</p><h1 className="max-w-xl text-balance text-5xl font-black leading-[0.98] tracking-[-0.06em] md:text-7xl">Catch the <span className="text-mint-dark">light.</span></h1><p className="mt-6 max-w-md text-pretty text-base leading-7 text-muted-foreground">Point your camera at the sender&apos;s grid and let Bridge rebuild your file, one colorful frame at a time.</p><div className="mt-8 rounded-3xl border border-border bg-card p-4 shadow-sm"><div className="flex items-center gap-3 rounded-2xl bg-muted p-4"><Camera className="text-mint-dark" size={22} /><div><p className="text-sm font-bold">Camera access ready</p><p className="font-mono text-xs text-muted-foreground">Aim at the color grid</p></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full bg-mint-dark" animate={{ width: `${progress}%` }} /></div><p className="mt-3 font-mono text-xs text-muted-foreground">{progress ? `${progress}% rebuilt` : 'Waiting for a signal...'}</p></div>
              </motion.div>}
            </AnimatePresence>
            <div className="mt-8 flex items-start gap-3 rounded-2xl bg-yellow/25 p-4 text-xs leading-5 text-foreground"><ShieldAlert size={18} className="mt-0.5 shrink-0 text-coral" /><p><strong>Photosensitivity notice:</strong> This app uses rapidly flashing colors. Do not use if you are sensitive to flashing lights or have photosensitive epilepsy.</p></div>
          </div>

          <div className="relative rounded-[2rem] border border-border bg-card p-4 shadow-[0_20px_60px_-20px_hsl(var(--primary)/0.25)] md:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Live transmission</p><p className="mt-1 text-sm font-bold">{beaming ? 'Sending frame 24 of 40' : 'Ready to beam'}</p></div><div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 font-mono text-[10px] font-bold"><span className={`h-2 w-2 rounded-full ${beaming ? 'animate-ping bg-coral' : 'bg-mint-dark'}`} /> {beaming ? 'ACTIVE' : 'IDLE'}</div></div><div className="grid aspect-square grid-cols-10 gap-1 rounded-2xl border-4 border-primary/10 bg-primary p-2 sm:gap-1.5 sm:p-3" aria-label="Optical color transmission grid">{grid.map((color, index) => <motion.div key={index} className="rounded-sm" style={{ backgroundColor: color }} animate={beaming ? { opacity: [0.3, 1, 0.5, 1], scale: [0.92, 1, 0.96, 1] } : { opacity: 0.9 }} transition={beaming ? { duration: 0.75, repeat: Infinity, delay: (index % 10) * 0.015 } : { duration: 0.2 }} />)}</div><div className="mt-5 flex items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-coral" /> 40 × 40 color grid</span><span className="font-mono">AES-256 local</span></div></div>
        </div>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5 text-xs text-muted-foreground"><p className="flex items-center gap-2"><AlertTriangle size={14} className="text-coral" /> Use in a well-lit space for best results.</p><button onClick={() => { setProgress(0); setBeaming(false) }} className="flex items-center gap-2 font-bold hover:text-foreground"><RotateCcw size={13} /> Reset bridge</button></footer>
      </section>
    </main>
  )
}
