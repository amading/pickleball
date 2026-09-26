import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import './liveViews.css'
import { orderedMatches, playable, teamsById, type LiveCategory, type LiveMatch } from './liveTypes'

type Props = { category: LiveCategory }

function statusLabel(match: LiveMatch, isNext: boolean) {
  if (match.status === 'live') return 'Live'
  if (match.status === 'final') return 'Final'
  if (match.status === 'bye') return 'Bye'
  if (!playable(match)) return 'Awaiting teams'
  return isNext ? 'Up next' : 'Queued'
}

export default function LiveSchedule({ category }: Props) {
  const rows = orderedMatches(category)
  const courts = [...new Set(rows.map(({ match }) => match.court))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const [courtChoice, setCourtChoice] = useState<string | null>(null)
  const court = courtChoice && courts.includes(courtChoice) ? courtChoice : courts[0]
  const teams = teamsById(category)
  const name = (id: string | null) => (id && teams.get(id)?.teamName) || 'Winner TBD'

  if (!category.draw) return <div className="live-category-empty">
    <strong>No schedule yet.</strong>
    <p>The court schedule appears after the organizer approves teams and publishes the random draw for {category.title}.</p>
    <a href={`?register=${encodeURIComponent(category.id)}`}>Open player registration <ArrowRight size={16} /></a>
  </div>

  const courtRows = rows.filter(({ match }) => match.court === court)
  const nextId = courtRows.find(({ match }) => match.status === 'scheduled' && playable(match))?.match.id
  const done = courtRows.filter(({ match }) => match.status === 'final' || match.status === 'bye').length

  return <div className="live-schedule">
    <div className="live-schedule-head">
      <div className="court-tabs" role="tablist" aria-label="Court">
        {courts.map((item) => <button type="button" role="tab" aria-selected={item === court} className={item === court ? 'active' : ''} key={item} onClick={() => setCourtChoice(item)}>{item}</button>)}
      </div>
      <span className="live-schedule-progress">{done} / {courtRows.length} games done on {court}</span>
    </div>
    <ol className="live-schedule-list">
      {courtRows.map(({ match, label }, index) => {
        const status = statusLabel(match, match.id === nextId)
        const decided = match.status === 'final' || match.status === 'live'
        return <li className={`live-schedule-row ${match.status} ${match.id === nextId ? 'next' : ''}`} key={match.id}>
          <span className="game-badge">{match.game ?? index + 1}</span>
          <div className="live-schedule-teams">
            <small>{label}{match.stage === 'playoff' ? ' · Playoff' : ''}</small>
            <span className={match.winner && match.winner === match.team1 ? 'won' : ''}>{name(match.team1)}{decided && <b>{match.score1}</b>}</span>
            <span className={match.winner && match.winner === match.team2 ? 'won' : ''}>{name(match.team2)}{decided && <b>{match.score2}</b>}</span>
          </div>
          <span className={`live-schedule-status ${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>
        </li>
      })}
    </ol>
  </div>
}
