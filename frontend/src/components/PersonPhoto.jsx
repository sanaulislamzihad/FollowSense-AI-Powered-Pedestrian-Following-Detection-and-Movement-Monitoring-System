import { useEffect, useState } from 'react'
import { ArrowRight, UserRound } from 'lucide-react'
import { url } from '../lib/api'

/** URL of the captured picture of the follower / leader of a following event. */
export const photoUrl = (event, role, kind = 'face') =>
  url(`/api/events/following/${event.id}/photo/${role}.jpg?kind=${kind}&v=${event.end_time}`)

/**
 * Captured picture of one person of a following event.
 * role: follower | leader · kind: face (face / head crop) | person (full body)
 */
export function PersonPhoto({ event, role, kind = 'face', className = '', onClick }) {
  const available = event.photos?.[role]
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [event.id, event.end_time, role, kind])
  const ring = role === 'follower' ? 'ring-rose-500' : 'ring-amber-500'
  const box = `relative overflow-hidden rounded-xl bg-slate-100 ring-2 ${ring} ${className}`
  if (!available || failed) {
    return (
      <div className={`${box} grid place-items-center text-slate-400`} title="No photo captured">
        <UserRound className="h-1/2 w-1/2" />
      </div>
    )
  }
  return (
    <button type="button" className={`${box} ${onClick ? 'cursor-zoom-in' : 'cursor-default'}`} onClick={onClick}>
      <img src={photoUrl(event, role, kind)} alt={`${role} ID ${event[`${role}_id`]}`}
        className={`h-full w-full ${kind === 'face' ? 'object-cover' : 'object-contain bg-slate-900'}`}
        onError={() => setFailed(true)} />
    </button>
  )
}

/** Follower photo → leader photo, the core "who follows whom" visual. */
export function FollowPair({ event, size = 'h-24 w-24', onClick }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <figure className="text-center">
        <PersonPhoto event={event} role="follower" className={size} onClick={onClick} />
        <figcaption className="mt-1.5 text-xs font-semibold text-rose-600">Follower · ID {event.follower_id}</figcaption>
      </figure>
      <div className="flex flex-col items-center text-rose-500 -mt-5">
        <span className="text-[10px] font-bold uppercase tracking-wider">follows</span>
        <ArrowRight className="h-6 w-6" />
      </div>
      <figure className="text-center">
        <PersonPhoto event={event} role="leader" className={size} onClick={onClick} />
        <figcaption className="mt-1.5 text-xs font-semibold text-amber-600">Followed · ID {event.leader_id}</figcaption>
      </figure>
    </div>
  )
}
