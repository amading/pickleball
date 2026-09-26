import { ArrowLeft, ArrowRight, MapPin, Radio, RefreshCw, ScanLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import LiveScoring from './LiveScoring'
import type { ScoringMatch, ScoringResponse } from './LiveScoring'
import './courtStation.css'

type StationMatch = {
  id: string; court: string; pool?: string; round?: number; game?: number
  stage: 'pool' | 'playoff'; status: 'scheduled' | 'live' | 'final' | 'bye'
  team1: string | null; team2: string | null; team1Name: string; team2Name: string
  score1: number; score2: number
}
type Station = { title: string; courts: number; matches: StationMatch[] }

const sampleTeams: Record<string, NonNullable<ScoringResponse['team1']>> = {
  a: { id: 'a', teamName: 'Smash Partners', players: [{ name: 'Alex Rivera', photo: '' }, { name: 'Sam Cruz', photo: '' }] },
  b: { id: 'b', teamName: 'Court Kings', players: [{ name: 'Jamie Reyes', photo: '' }, { name: 'Pat Santos', photo: '' }] },
  c: { id: 'c', teamName: 'Rally Squad', players: [{ name: 'Taylor Lim', photo: '' }, { name: 'Morgan Lee', photo: '' }] },
  d: { id: 'd', teamName: 'Net Ninjas', players: [{ name: 'Chris Tan', photo: '' }, { name: 'Robin Dela Cruz', photo: '' }] },
  e: { id: 'e', teamName: 'Spin Doctors', players: [{ name: 'Kai Flores', photo: '' }, { name: 'Riley Garcia', photo: '' }] },
  f: { id: 'f', teamName: 'Ace Makers', players: [{ name: 'Drew Ramos', photo: '' }, { name: 'Casey Torres', photo: '' }] },
}
const sampleMatches: ScoringMatch[] = [
  { id: 'sample-1', stage: 'pool', pool: 'Pool A', game: 1, court: 'Court 1', team1: 'a', team2: 'b', score1: 10, score2: 9, status: 'live', winner: null, version: 0, scoreEvents: [] },
  { id: 'sample-2', stage: 'pool', pool: 'Pool B', game: 2, court: 'Court 2', team1: 'c', team2: 'd', score1: 0, score2: 0, status: 'scheduled', winner: null, version: 0, scoreEvents: [] },
  { id: 'sample-3', stage: 'pool', pool: 'Pool C', game: 3, court: 'Court 3', team1: 'e', team2: 'f', score1: 0, score2: 0, status: 'scheduled', winner: null, version: 0, scoreEvents: [] },
]

export default function CourtStation({ stationKey, demo = false }: { stationKey: string; demo?: boolean }) {
  const [categoryId, token] = stationKey.split('.')
  const [station, setStation] = useState<Station | null>(null)
  const [demoMatches, setDemoMatches] = useState(sampleMatches)
  const [court, setCourt] = useState('')
  const [matchId, setMatchId] = useState('')
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (demo || !categoryId || !token) return
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
  }, [categoryId, token, refresh, demo])

  const activeStation = demo ? { title: 'Mobile scoring preview', courts: 3, matches: demoMatches.map((match) => ({ ...match, team1Name: sampleTeams[match.team1 ?? '']?.teamName ?? 'Waiting', team2Name: sampleTeams[match.team2 ?? '']?.teamName ?? 'Waiting' })) } : station
  const chosen = demoMatches.find((match) => match.id === matchId)
  if (matchId) return <LiveScoring scoreKey={`${categoryId || 'demo'}.${matchId}.${token || 'sample'}`} stationToken={demo ? undefined : token} onBack={() => { setMatchId(''); setRefresh((value) => value + 1) }} demoData={demo && chosen ? { categoryId: 'demo', categoryTitle: 'Mobile scoring preview', pointsToWin: 11, winBy: 2, match: chosen, team1: sampleTeams[chosen.team1 ?? ''] ?? null, team2: sampleTeams[chosen.team2 ?? ''] ?? null } : undefined} onDemoSave={(updated) => setDemoMatches((matches) => matches.map((match) => match.id === updated.id ? updated : match))} />

  const courts = Array.from({ length: activeStation?.courts ?? 0 }, (_, index) => `Court ${index + 1}`)
  const games = activeStation?.matches.filter((match) => match.court === court && match.status !== 'bye') ?? []
  const live = games.filter((match) => match.status === 'live')
  const next = games.filter((match) => match.status === 'scheduled' && match.team1 && match.team2)
  const later = games.filter((match) => match.status === 'scheduled' && (!match.team1 || !match.team2))
  const final = games.filter((match) => match.status === 'final')
  const ordered = [...live, ...next, ...later, ...final]

  return <main className="station-page"><div className="station-shell">
    <header className="station-top"><a href="/"><ArrowLeft size={17} /> Tournament HQ</a><span><ScanLine size={17} /> COURT STATION</span></header>
    <div className="station-intro"><span className="station-eyebrow"><Radio size={13} /> {demo ? 'SAMPLE PREVIEW · NO REAL RESULTS' : 'SCANNED · READY TO SCORE'}</span><h1>{court ? <>Choose your <em>game.</em></> : <>Choose your <em>court.</em></>}</h1><p>{activeStation?.title || 'Loading tournament…'}</p></div>
    {error && <div className="score-error">{error}</div>}
    {!activeStation && !error && <div className="score-loading">Opening court station…</div>}
    {activeStation && !court && <div className="station-courts">{courts.map((name) => {
      const courtGames = activeStation.matches.filter((match) => match.court === name && match.status !== 'bye')
      const active = courtGames.filter((match) => match.status === 'live').length
      const upcoming = courtGames.filter((match) => match.status === 'scheduled').length
      return <button type="button" className="station-court" key={name} onClick={() => setCourt(name)}><span className="station-court-icon"><MapPin size={22} /></span><span><small>SCORING LANE {name.split(' ')[1]}</small><strong>{name}</strong><em>{active ? `${active} live ${active === 1 ? 'game' : 'games'}` : upcoming ? `${upcoming} ${upcoming === 1 ? 'game' : 'games'} to play` : 'No upcoming games'}</em></span><ArrowRight size={22} /></button>
    })}</div>}
    {activeStation && court && <><div className="station-selection"><button type="button" onClick={() => setCourt('')}><ArrowLeft size={16} /> All courts</button><strong>{court}</strong>{!demo && <button type="button" aria-label="Refresh games" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={17} /></button>}</div>
      <div className="station-games">{ordered.length ? ordered.map((match) => <button type="button" className={`station-game ${match.status}`} key={match.id} disabled={!match.team1 || !match.team2} onClick={() => setMatchId(match.id)}><span className="station-game-head"><small>{match.stage === 'pool' ? `${match.pool} · GAME ${match.game}` : `PLAYOFF · ROUND ${match.round}`}</small><b>{match.status === 'live' ? '● LIVE' : match.status === 'final' ? 'FINAL' : match.team1 && match.team2 ? 'READY' : 'WAITING'}</b></span><span className="station-game-teams"><strong>{match.team1Name}</strong><span>{match.score1} : {match.score2}</span><strong>{match.team2Name}</strong></span><span className="station-game-foot">{match.status === 'final' ? 'View result' : match.team1 && match.team2 ? 'Tap to score' : 'Waiting for teams'} <ArrowRight size={16} /></span></button>) : <p className="station-empty">No games assigned to this court yet.</p>}</div>
    </>}
  </div></main>
}
