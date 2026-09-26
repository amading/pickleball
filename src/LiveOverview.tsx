import { ArrowRight, CalendarClock, CheckCircle2, Radio, Trophy, Users } from 'lucide-react'
import './liveViews.css'
import { orderedMatches, playable, teamsById, type LiveCategory, type LiveMatch } from './liveTypes'

type Props = { categories: LiveCategory[]; loaded: boolean; offline: boolean; onOpenBoard: (categoryId: string) => void; onOpenOrganizer: () => void }
type Row = { category: LiveCategory; match: LiveMatch; label: string }

export default function LiveOverview({ categories, loaded, offline, onOpenBoard, onOpenOrganizer }: Props) {
  const rows: Row[] = categories.flatMap((category) => orderedMatches(category).map(({ match, label }) => ({ category, match, label })))
  const scored = rows.filter(({ match }) => match.status !== 'bye')
  const finals = scored.filter(({ match }) => match.status === 'final').length
  const onCourt = rows.filter(({ match }) => match.status === 'live')
  const busyCourts = new Set(onCourt.map(({ category, match }) => `${category.id}::${match.court}`))
  const upNext: Row[] = []
  const seenCourts = new Set<string>()
  for (const row of rows) {
    const key = `${row.category.id}::${row.match.court}`
    if (row.match.status !== 'scheduled' || !playable(row.match) || seenCourts.has(key)) continue
    seenCourts.add(key)
    upNext.push(row)
  }
  const approved = categories.reduce((sum, category) => sum + category.approvedCount, 0)
  const champions = categories.flatMap((category) => {
    const final = category.playoff?.rounds.at(-1)?.matches[0]
    const team = final?.winner ? teamsById(category).get(final.winner) : null
    return team ? [{ category, team }] : []
  })

  return <>
    <div className="dashboard-heading"><div><span className="eyebrow">TOURNAMENT PULSE</span><h2>The event at a glance</h2></div><span className={`demo-indicator ${offline ? '' : 'live'}`}>{offline ? 'Server offline' : 'Live data'}</span></div>
    <section className="metric-grid" aria-label="Tournament summary">
      <article className="metric-card"><span className="metric-icon"><Trophy size={21} /></span><span>{categories.length}</span><p>Live categories</p></article>
      <article className="metric-card"><span className="metric-icon"><Users size={21} /></span><span>{approved}</span><p>Approved teams</p></article>
      <article className="metric-card"><span className="metric-icon"><CheckCircle2 size={21} /></span><span>{finals}<small className="metric-of">/{scored.length}</small></span><p>Games final</p></article>
      <article className="metric-card"><span className="metric-icon"><Radio size={21} /></span><span>{onCourt.length}</span><p>On court now</p></article>
    </section>

    {!loaded ? <div className="live-overview-empty">Loading live tournament data...</div> : categories.length === 0 ? (
      <div className="live-overview-empty">
        <strong>{offline ? 'Cannot reach the tournament server.' : 'No live categories yet.'}</strong>
        <p>{offline ? 'Start it with "npm run dev" (or "npm start") and this page reconnects automatically.' : 'Create a category in Organizer, approve teams, then publish the draw. Everything here updates from real results.'}</p>
        {!offline && <button type="button" onClick={onOpenOrganizer}>Open Organizer <ArrowRight size={16} /></button>}
      </div>
    ) : <div className="live-overview-grid">
      {champions.length > 0 && <section className="live-overview-card champions"><h3><Trophy size={17} /> Champions</h3>{champions.map(({ category, team }) => <button type="button" className="live-overview-row" key={category.id} onClick={() => onOpenBoard(category.id)}><small>{category.title}</small><strong>{team.teamName}</strong></button>)}</section>}
      <section className="live-overview-card"><h3><Radio size={17} /> On court now</h3>{onCourt.length ? onCourt.map((row) => <MatchRow row={row} key={row.match.id} onOpen={onOpenBoard} />) : <p className="live-overview-note">No match is being scored right now. Matches appear here as soon as a court QR records a point.</p>}</section>
      <section className="live-overview-card"><h3><CalendarClock size={17} /> Up next by court</h3>{upNext.length ? upNext.map((row) => <MatchRow row={row} key={row.match.id} onOpen={onOpenBoard} waiting={busyCourts.has(`${row.category.id}::${row.match.court}`)} />) : <p className="live-overview-note">{categories.some((category) => category.draw) ? 'Every published match is decided or waiting for earlier results.' : 'Matches appear after the organizer publishes a draw.'}</p>}</section>
    </div>}
  </>
}

function MatchRow({ row, onOpen, waiting = false }: { row: Row; onOpen: (categoryId: string) => void; waiting?: boolean }) {
  const teams = teamsById(row.category)
  const { match } = row
  const name = (id: string | null) => (id && teams.get(id)?.teamName) || 'TBD'
  return <button type="button" className="live-overview-row" onClick={() => onOpen(row.category.id)}>
    <small>{row.category.title} · {row.label}{match.game ? ` · Game ${match.game}` : ''} · {match.court}{waiting ? ' · after current game' : ''}</small>
    <strong>{name(match.team1)} <em>{match.status === 'live' ? `${match.score1} - ${match.score2}` : 'vs'}</em> {name(match.team2)}</strong>
  </button>
}
