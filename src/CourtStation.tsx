import { ArrowLeft, ArrowRight, MapPin, Radio, RefreshCw, ScanLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import LiveScoring from './LiveScoring'
import './courtStation.css'

type StationMatch = {
  id: string; court: string; pool?: string; round?: number; game?: number
  stage: 'pool' | 'playoff'; status: 'scheduled' | 'live' | 'final' | 'bye'
  team1: string | null; team2: string | null; team1Name: string; team2Name: string
  score1: number; score2: number
}
type Station = { title: string; courts: number; matches: StationMatch[] }

export default function CourtStation({ stationKey }: { stationKey: string }) {
  const [categoryId, token] = stationKey.split('.')
  const [station, setStation] = useState<Station | null>(null)
  const [court, setCourt] = useState('')
  const [matchId, setMatchId] = useState('')
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!categoryId || !token) return
    let active = true
    async function load() {
      try {
        const response = await fetch(`/api/categories/${categoryId}/station`, { cache: 'no-cache', headers: { 'x-station-token': token } })
        const value = await response.json()
        if (!response.ok) throw new Error(value.error || 'Could not open court station.')
        if (active) { setStation(value); setError('') }
      } catch (problem) { if (active) setError((problem as Error).message) }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [categoryId, token, refresh])

  if (matchId) return <LiveScoring scoreKey={`${categoryId}.${matchId}.${token}`} stationToken={token} onBack={() => { setMatchId(''); setRefresh((value) => value + 1) }} />

  const courts = Array.from({ length: station?.courts ?? 0 }, (_, index) => `Court ${index + 1}`)
  const games = station?.matches.filter((match) => match.court === court && match.status !== 'bye') ?? []
  const live = games.filter((match) => match.status === 'live')
  const next = games.filter((match) => match.status === 'scheduled' && match.team1 && match.team2)
  const later = games.filter((match) => match.status === 'scheduled' && (!match.team1 || !match.team2))
  const final = games.filter((match) => match.status === 'final')
  const ordered = [...live, ...next, ...later, ...final]

  return <main className="station-page"><div className="station-shell">
    <header className="station-top"><a href="/"><ArrowLeft size={17} /> Tournament HQ</a><span><ScanLine size={17} /> COURT STATION</span></header>
    <div className="station-intro"><span className="station-eyebrow"><Radio size={13} /> SCANNED · READY TO SCORE</span><h1>{court ? <>Choose your <em>game.</em></> : <>Choose your <em>court.</em></>}</h1><p>{station?.title || 'Loading tournament…'}</p></div>
    {error && <div className="score-error">{error}</div>}
    {!station && !error && <div className="score-loading">Opening court station…</div>}
    {station && !court && <div className="station-courts">{courts.map((name) => {
      const courtGames = station.matches.filter((match) => match.court === name && match.status !== 'bye')
      const active = courtGames.filter((match) => match.status === 'live').length
      const upcoming = courtGames.filter((match) => match.status === 'scheduled').length
      return <button type="button" className="station-court" key={name} onClick={() => setCourt(name)}><span className="station-court-icon"><MapPin size={22} /></span><span><small>SCORING LANE {name.split(' ')[1]}</small><strong>{name}</strong><em>{active ? `${active} live game` : upcoming ? `${upcoming} games to play` : 'No upcoming games'}</em></span><ArrowRight size={22} /></button>
    })}</div>}
    {station && court && <><div className="station-selection"><button type="button" onClick={() => setCourt('')}><ArrowLeft size={16} /> All courts</button><strong>{court}</strong><button type="button" aria-label="Refresh games" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={17} /></button></div>
      <div className="station-games">{ordered.length ? ordered.map((match) => <button type="button" className={`station-game ${match.status}`} key={match.id} disabled={!match.team1 || !match.team2} onClick={() => setMatchId(match.id)}><span className="station-game-head"><small>{match.stage === 'pool' ? `${match.pool} · GAME ${match.game}` : `PLAYOFF · ROUND ${match.round}`}</small><b>{match.status === 'live' ? '● LIVE' : match.status === 'final' ? 'FINAL' : match.team1 && match.team2 ? 'READY' : 'WAITING'}</b></span><span className="station-game-teams"><strong>{match.team1Name}</strong><span>{match.score1} : {match.score2}</span><strong>{match.team2Name}</strong></span><span className="station-game-foot">{match.status === 'final' ? 'View result' : match.team1 && match.team2 ? 'Tap to score' : 'Waiting for teams'} <ArrowRight size={16} /></span></button>) : <p className="station-empty">No games assigned to this court yet.</p>}</div>
    </>}
  </div></main>
}
