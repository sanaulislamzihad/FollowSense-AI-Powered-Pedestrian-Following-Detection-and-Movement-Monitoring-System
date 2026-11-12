import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Camera, Cctv, CircleStop, Film, Play, Radio, Trash2, Upload } from 'lucide-react'
import { api, uploadVideo } from '../lib/api'
import { useLive } from '../lib/realtime'
import { Badge, Progress } from './ui'

/**
 * The two ways to feed the system, side by side:
 *   1. Saved video  - upload a recorded file, analysis starts automatically
 *   2. CCTV live    - connect an RTSP / HTTP stream (or a webcam) and analyse it in real time
 */
export default function SourcePicker({ onStarted }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <SavedVideo onStarted={onStarted} />
      <CctvLive onStarted={onStarted} />
    </div>
  )
}

function OptionCard({ icon: Icon, tone, step, title, hint, children }) {
  return (
    <section className="card p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className={`h-11 w-11 shrink-0 rounded-xl grid place-items-center ${tone}`}><Icon size={22} /></div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Option {step}</div>
          <h2 className="font-semibold text-slate-900 leading-tight">{title}</h2>
          <p className="text-sm text-slate-500">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function SavedVideo({ onStarted }) {
  const nav = useNavigate()
  const input = useRef(null)
  const [drag, setDrag] = useState(false)
  const [upload, setUpload] = useState(null) // { name, p }
  const [error, setError] = useState('')

  const handle = async (files) => {
    const file = files[0]
    if (!file) return
    setError('')
    setUpload({ name: file.name, p: 0 })
    try {
      const video = await uploadVideo(file, { onProgress: (p) => setUpload({ name: file.name, p }) })
      onStarted?.()
      if (video?.latest_job) nav(`/monitor?job=${video.latest_job.id}`)
    } catch (e) {
      setError(e.message)
    }
    setUpload(null)
  }

  return (
    <OptionCard icon={Film} tone="bg-brand-50 text-brand-700" step="1" title="Saved video"
      hint="Upload recorded footage. It is analysed in the background; results and photos appear below.">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handle([...e.dataTransfer.files]) }}
        onClick={() => !upload && input.current?.click()}
        className={`rounded-xl border-2 border-dashed text-center px-4 py-7 cursor-pointer transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400'}`}>
        <Upload className="mx-auto h-7 w-7 text-brand-600" />
        <div className="mt-2 text-sm font-semibold text-slate-800">Drop a video here or click to browse</div>
        <div className="text-xs text-slate-500">MP4, MOV, AVI, MKV</div>
        <input ref={input} type="file" accept="video/*,.mov,.mkv" hidden
          onChange={(e) => { handle([...e.target.files]); e.target.value = '' }} />
      </div>
      {upload && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm truncate flex-1">{upload.name}</span>
          <Progress className="w-32" value={upload.p} />
          <span className="text-sm tabular-nums w-10 text-right">{Math.round(upload.p * 100)}%</span>
        </div>
      )}
      {error && <div className="mt-3 text-sm text-rose-600">{error}</div>}
      <div className="mt-3 text-sm"><Link className="text-brand-700 font-medium" to="/videos">All uploaded videos →</Link></div>
    </OptionCard>
  )
}

function CctvLive({ onStarted }) {
  const nav = useNavigate()
  const { data: cameras, reload } = useLive(api.cameras, [], 5000)
  const [form, setForm] = useState({ name: '', source_url: '', location: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const start = async (cam) => {
    setError('')
    try {
      const job = await api.createJob({ camera_id: cam.id })
      onStarted?.()
      reload()
      nav(`/monitor?job=${job.id}`)
    } catch (e) { setError(e.message) }
  }
  const stop = async (cam) => { await api.stopJob(cam.live_job_id); reload() }
  const remove = async (cam) => {
    if (!confirm(`Remove camera "${cam.name}"?`)) return
    await api.deleteCamera(cam.id)
    reload()
  }
  const connect = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const cam = await api.createCamera({ ...form, name: form.name || 'CCTV camera' })
      setForm({ name: '', source_url: '', location: '' })
      await start(cam)
    } catch (ex) { setError(ex.message) }
    setBusy(false)
  }

  return (
    <OptionCard icon={Cctv} tone="bg-rose-50 text-rose-600" step="2" title="CCTV live"
      hint="Connect a camera stream. It is analysed in real time and alerts pop up as they happen.">
      {cameras?.length > 0 && (
        <ul className="divide-y divide-slate-100 mb-3 max-h-44 overflow-auto">
          {cameras.map((c) => (
            <li key={c.id} className="py-2 flex items-center gap-3">
              <Camera size={17} className="text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.name}{c.location && <span className="text-slate-400"> · {c.location}</span>}</div>
                <div className="text-xs text-slate-500 truncate">{c.source_url}</div>
              </div>
              {c.live_job_id ? (
                <>
                  <Link to={`/monitor?job=${c.live_job_id}`}><Badge className="bg-rose-100 text-rose-700"><Radio size={12} className="mr-1" />LIVE</Badge></Link>
                  <button className="btn-ghost !px-2 !py-1" title="Stop" onClick={() => stop(c)}><CircleStop size={15} /></button>
                </>
              ) : (
                <>
                  <button className="btn-primary !py-1.5" onClick={() => start(c)}><Play size={14} /> Start</button>
                  <button className="text-slate-400 hover:text-rose-600" title="Remove" onClick={() => remove(c)}><Trash2 size={15} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={connect} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="Camera name (e.g. Main gate)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Location (optional)" value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <input className="input flex-1" required placeholder="rtsp://user:pass@192.168.1.20:554/stream1   (or 0 for a webcam)"
            value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} />
          <button className="btn-danger whitespace-nowrap" disabled={busy}><Radio size={16} /> Connect &amp; start</button>
        </div>
      </form>
      {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}
    </OptionCard>
  )
}
