import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Eye, Film, Footprints, Radio, X } from 'lucide-react'
import { api } from '../lib/api'
import { useLive } from '../lib/realtime'
import { Badge, Card, Empty, PageHeader } from '../components/ui'
import { FollowPair } from '../components/PersonPhoto'
import SourcePicker from '../components/SourcePicker'
import { EventModal } from './Events'
import { fmtPct, fmtTime } from '../lib/format'

/** "Who is following whom": captured photos of every follower / followed pair. */
export default function Watch() {
  const [jobId, setJobId] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)
  const [hideDismissed, setHideDismissed] = useState(true)
  const [selected, setSelected] = useState(null)
  const { data: jobs } = useLive(() => api.jobs(), [], 5000)
  const query = useMemo(() => (jobId ? { job_id: jobId } : {}), [jobId])
  const { data: events, reload } = useLive(() => api.following(query), [query], 4000)

  // deep link: /watch?event=12 opens that detection (used by alerts and shared links)
  const [params] = useSearchParams()
  const linked = Number(params.get('event')) || null
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (!linked || opened || !events) return
    const ev = events.find((e) => e.id === linked)
    if (ev) { setSelected(ev); setOpened(true) }
  }, [linked, opened, events])

  const shown = useMemo(() => (events || []).filter((e) =>
    (!onlyActive || e.is_active) && (!hideDismissed || e.status !== 'dismissed')), [events, onlyActive, hideDismissed])
  const active = shown.filter((e) => e.is_active)
  const past = shown.filter((e) => !e.is_active)

  // many-to-many context: who else a person follows / is followed by (within the same analysis)
  const context = useMemo(() => {
    const map = {}
    for (const e of events || []) {
      if (e.status === 'dismissed') continue
      const f = (map[`${e.job_id}:${e.follower_id}`] ||= { follows: new Set(), followedBy: new Set() })
      const l = (map[`${e.job_id}:${e.leader_id}`] ||= { follows: new Set(), followedBy: new Set() })
      f.follows.add(e.leader_id)
      l.followedBy.add(e.follower_id)
    }
    return map
  }, [events])

  const review = async (ev, status) => { await api.reviewFollowing(ev.id, { status }); reload() }
  const card = (e) => (
    <FollowCard key={e.id} event={e} context={context} onOpen={() => setSelected(e)} onReview={review} />
  )

  return (
    <>
      <PageHeader title="Follow Watch"
        subtitle="Who is following whom — photos are captured automatically from saved videos and live CCTV" />

      <SourcePicker onStarted={reload} />

      <div className="card p-4 mt-6 mb-5 flex flex-wrap gap-x-6 gap-y-3 items-end">
        <div>
          <label className="label">Source</label>
          <select className="input w-auto min-w-[240px]" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">All videos and cameras</option>
            {(jobs || []).map((j) => (
              <option key={j.id} value={j.id}>#{j.id} · {j.is_live ? 'CCTV' : 'Video'} · {j.source_name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 pb-2">
          <input type="checkbox" className="accent-teal-700" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          Happening now only
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 pb-2">
          <input type="checkbox" className="accent-teal-700" checked={hideDismissed} onChange={(e) => setHideDismissed(e.target.checked)} />
          Hide dismissed
        </label>
        <div className="ml-auto text-sm text-slate-500 pb-2">
          {shown.length} detection{shown.length === 1 ? '' : 's'} · <span className="text-rose-600 font-semibold">{active.length} happening now</span>
        </div>
      </div>

      {active.length > 0 && (
        <section className="mb-8">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 mb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" /> Happening now
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">{active.map(card)}</div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="font-semibold text-slate-900 mb-3">Detected</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">{past.map(card)}</div>
        </section>
      )}

      {!shown.length && (
        <Card>
          <Empty icon={Footprints} title="Nobody has been detected following someone yet">
            Upload a saved video or connect a CCTV camera above. When one person keeps following another,
            both of their photos appear here.
          </Empty>
        </Card>
      )}

      <EventModal event={selected} onClose={() => setSelected(null)} onSaved={() => { reload(); setSelected(null) }} />
    </>
  )
}

function FollowCard({ event: e, context, onOpen, onReview }) {
  const follower = context[`${e.job_id}:${e.follower_id}`]
  const leader = context[`${e.job_id}:${e.leader_id}`]
  const notes = []
  const others = (set, skip) => [...(set || [])].filter((id) => id !== skip).sort((a, b) => a - b)
  const alsoFollows = others(follower?.follows, e.leader_id)
  if (alsoFollows.length) notes.push(`ID ${e.follower_id} also follows ID ${alsoFollows.join(', ')}`)
  const followerFollowedBy = others(follower?.followedBy)
  if (followerFollowedBy.length) notes.push(`ID ${e.follower_id} is followed by ID ${followerFollowedBy.join(', ')}`)
  const leaderAlsoBy = others(leader?.followedBy, e.follower_id)
  if (leaderAlsoBy.length) notes.push(`ID ${e.leader_id} is also followed by ID ${leaderAlsoBy.join(', ')}`)
  const leaderFollows = others(leader?.follows)
  if (leaderFollows.length) notes.push(`ID ${e.leader_id} follows ID ${leaderFollows.join(', ')}`)

  return (
    <article className={`card p-4 flex flex-col ${e.is_active ? 'ring-2 ring-rose-300' : ''}`}>
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
        {e.is_live
          ? <Badge className="bg-rose-100 text-rose-700"><Radio size={11} className="mr-1" />CCTV</Badge>
          : <Badge className="bg-brand-50 text-brand-700"><Film size={11} className="mr-1" />Video</Badge>}
        <span className="truncate flex-1" title={e.source_name}>{e.source_name}</span>
        <Badge status={e.status} />
      </div>

      <FollowPair event={e} size="h-28 w-28" onClick={onOpen} />

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Metric label="Confidence" value={fmtPct(e.confidence)} strong />
        <Metric label="Duration" value={`${e.duration.toFixed(1)}s`} />
        <Metric label="At" value={fmtTime(e.start_time)} />
      </div>

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}

      <div className="mt-auto pt-4 flex items-center gap-2">
        <button className="btn-ghost !py-1.5" onClick={onOpen}><Eye size={15} /> Inspect</button>
        <button className="btn-ghost !px-2 !py-1.5" title="Confirm" onClick={() => onReview(e, 'confirmed')}><Check size={15} /></button>
        <button className="btn-ghost !px-2 !py-1.5" title="Dismiss" onClick={() => onReview(e, 'dismissed')}><X size={15} /></button>
        <Link className="ml-auto text-sm text-brand-700 font-medium" to={`/monitor?job=${e.job_id}`}>
          {e.is_active ? 'Watch live →' : 'Open video →'}
        </Link>
      </div>
    </article>
  )
}

function Metric({ label, value, strong }) {
  return (
    <div className="rounded-lg bg-slate-50 py-2">
      <div className="text-[10px] uppercase font-semibold tracking-wide text-slate-500">{label}</div>
      <div className={`font-bold tabular-nums ${strong ? 'text-rose-600' : 'text-slate-800'}`}>{value}</div>
    </div>
  )
}
