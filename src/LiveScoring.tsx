import { ArrowLeft, Check, CheckCircle2, Minus, Plus, RefreshCw, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import './liveScoring.css'
import { avatarSrc } from './liveTypes'
import { authHeaders, readToken } from './adminApi'

type Team = { id: string; teamName: string; players: { name: string; photo: string }[] }
type ScoreEvent = { id: string; team: 1 | 2 | null; change: number; score1: number; score2: number; at: string }
type Match = { id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; game?: number; team1: string | null; team2: string | null; score1: number; score2: number; status: 'scheduled' | 'live' | 'final' | 'bye'; winner: string | null; version: number; scoreEvents?: ScoreEvent[] }
type MatchResponse = { categoryId: string; categoryTitle: string; pointsToWin: number; winBy: number; match: Match; team1: Team | null; team2: Team | null }

// Mirrors the server rule: reach the target by winBy, and past the target the lead is exactly winBy (13-11, never 15-2).
function validFinal(first: number, second: number, pointsToWin: number, winBy: number) {
  const high = Math.max(first, second)
  const margin = Math.abs(first - second)
  return high >= pointsToWin && margin >= winBy && (high === pointsToWin || margin === winBy)
}

export default function LiveScoring({ scoreKey, stationToken, onBack }: { scoreKey: string; stationToken?: string; onBack?: () => void }) {
  const [categoryId, matchId, token] = scoreKey.split('.')
  const [data, setData] = useState<MatchResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [lastSaved, setLastSaved] = useState(false)
  // Signed-in organizers may correct or reopen final scores from this page.
  const adminToken = readToken()
  const invalidScoreKey = !categoryId || !matchId || !token

  useEffect(() => {
    if (invalidScoreKey) return
    let active = true
    async function loadMatch() {
      try {
        const response = await fetch(`/api/categories/${categoryId}/matches/${matchId}`, { cache: 'no-cache', headers: { 'x-score-token': token, ...(stationToken ? { 'x-station-token': stationToken } : {}), ...authHeaders(adminToken) } })
        const value = await response.json().catch(() => null)
        if (!value) throw new Error('The tournament server is not responding. Scores will sync when it is back.')
        if (!response.ok) throw new Error(value.error || 'Match not found.')
        if (active) { setData(value); setError('') }
      } catch (problem) { if (active) setError((problem as Error).message) }
    }
    void loadMatch()
    const timer = window.setInterval(() => { if (!busy) void loadMatch() }, 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [categoryId, matchId, token, adminToken, stationToken, invalidScoreKey, busy, refreshIndex])

  async function save(score1: number, score2: number, status: 'live' | 'final') {
    if (!data || busy) return
    setBusy(true); setError(''); setLastSaved(false)
    try {
      const response = await fetch(`/api/categories/${categoryId}/matches/${matchId}/score`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-score-token': token, ...(stationToken ? { 'x-station-token': stationToken } : {}), ...authHeaders(adminToken) },
        body: JSON.stringify({ score1, score2, status, version: data.match.version }),
      })
      const value = await response.json().catch(() => null)
      if (!value) throw new Error('Score not saved: the tournament server is not responding.')
      if (!response.ok) throw new Error(value.error || 'Score could not be saved.')
      setData((current) => current ? { ...current, match: value } : current)
      setLastSaved(true)
      if (status === 'live' && 'vibrate' in navigator) navigator.vibrate(25)
      if (status === 'final') setRefreshIndex((current) => current + 1)
    } catch (problem) { setError((problem as Error).message); setRefreshIndex((current) => current + 1) }
    finally { setBusy(false) }
  }

  const match = data?.match
  const canScore = Boolean(token) && Boolean(data?.team1 && data.team2) && (match?.status !== 'final' || Boolean(adminToken)) && match?.status !== 'bye'
  const leader = match && match.score1 !== match.score2 ? (match.score1 > match.score2 ? data?.team1 : data?.team2) : null
  const finalWinner = match?.winner === data?.team1?.id ? data?.team1 : match?.winner === data?.team2?.id ? data?.team2 : null
  const canFinalize = Boolean(match && validFinal(match.score1, match.score2, data?.pointsToWin ?? 11, data?.winBy ?? 2))
  return <main className="score-page"><div className="score-shell"><header className="score-top">{onBack ? <button type="button" className="score-back" onClick={onBack}><ArrowLeft size={17} /> {match?.court || 'All games'}</button> : <a href={`/?register=${categoryId}`}><ArrowLeft size={17} /> Tournament page</a>}<span>RALLY <b>HQ</b> / SCORE</span></header>
    {data ? <><div className="score-event"><span className="score-kicker">COURTSIDE SCORING · {data.categoryTitle}</span><h1>{match?.court}</h1><p>{match?.stage === 'pool' ? `${match.pool} · Game ${match.game}` : `Playoff · Round ${match?.round}`} <span>•</span> First to {data.pointsToWin}, win by {data.winBy}</p></div>
      <div className="score-status-line"><span className={`score-status ${match?.status}`}><i /> {match?.status === 'final' ? 'FINAL RESULT' : match?.status === 'live' ? 'MATCH IN PROGRESS' : 'READY TO PLAY'}</span><span className="score-sync">{busy ? 'Saving…' : lastSaved ? <><Check size={14} /> Saved live</> : 'Live sync'} <button type="button" aria-label="Sync score" onClick={() => setRefreshIndex((current) => current + 1)}><RefreshCw size={15} /></button></span></div>
      {finalWinner && <div className="score-winner-banner"><Trophy size={21} /><span>WINNER LOCKED</span><strong>{finalWinner.teamName}</strong></div>}
      <div className="score-versus">{([data.team1, data.team2] as const).map((team, index) => {
        const teamScore = index === 0 ? match?.score1 ?? 0 : match?.score2 ?? 0
        return <section className={`score-team-card ${match?.winner === team?.id ? 'winner' : ''} ${leader?.id === team?.id && match?.status !== 'final' ? 'leading' : ''}`} key={index}>
          <div className="score-team-head"><div className="score-photos">{team?.players.map((player) => <img src={avatarSrc(player.name, player.photo)} alt={player.name} key={player.name} />)}</div><span>TEAM {index + 1}</span></div>
          <h2>{team?.teamName || 'Waiting for opponent'}</h2>
          <div className="score-player-list">{team?.players.map((player) => <div key={player.name}><img src={avatarSrc(player.name, player.photo)} alt="" /><span>{player.name}</span></div>)}</div>
          <div className="score-number">{teamScore}</div>
          {match?.winner === team?.id && <div className="score-winner"><Trophy size={16} /> WINNER</div>}
          {canScore && <div className="score-controls"><button type="button" aria-label={`Undo point from ${team?.teamName}`} disabled={busy || teamScore === 0} onClick={() => void save(index === 0 ? Math.max(0, match!.score1 - 1) : match!.score1, index === 1 ? Math.max(0, match!.score2 - 1) : match!.score2, 'live')}><Minus size={19} /> Undo</button><button type="button" aria-label={`Add point to ${team?.teamName}`} disabled={busy || teamScore >= 999} onClick={() => void save(index === 0 ? match!.score1 + 1 : match!.score1, index === 1 ? match!.score2 + 1 : match!.score2, 'live')}><Plus size={24} /> POINT</button></div>}
        </section>
      })}</div>
      <div className="score-ledger"><div className="score-ledger-head"><div><span>POINT TRACKER</span><h3>Who scored?</h3></div><strong>{(match?.scoreEvents ?? []).filter((event) => event.change > 0).length} recorded taps</strong></div><p>Each checked box is a saved point. Corrections appear in the activity below.</p><div className="score-ledger-teams">{([data.team1, data.team2] as const).map((team, index) => <div key={index}><span>{team?.teamName || `Team ${index + 1}`}</span><div className="score-ledger-boxes">{Array.from({ length: index === 0 ? match?.score1 ?? 0 : match?.score2 ?? 0 }, (_, point) => <span className="score-ledger-box" key={point} title={`Point ${point + 1}`}><Check size={12} /></span>)}</div><b>{index === 0 ? match?.score1 : match?.score2}</b></div>)}</div>{Boolean(match?.scoreEvents?.length) && <div className="score-ledger-history">{match!.scoreEvents!.slice(-5).reverse().map((event) => <span key={event.id}>{event.change > 0 ? '✓' : '↶'} {event.team === 1 ? data.team1?.teamName : event.team === 2 ? data.team2?.teamName : 'Score correction'} {event.change > 0 ? `+${event.change}` : event.change} <b>{event.score1}–{event.score2}</b></span>)}</div>}</div>
      {error && <div className="score-error">{error}</div>}
      {match?.status === 'final' ? <div className="score-final"><CheckCircle2 size={20} /> Result saved. Winner is {finalWinner?.teamName || 'confirmed'}.{match.stage === 'playoff' ? ' Bracket advanced automatically.' : ' Standings updated automatically.'}{adminToken && <button type="button" disabled={busy} onClick={() => void save(match.score1, match.score2, 'live')}>Reopen as organizer</button>}</div> : <button className="score-finish" type="button" disabled={!canScore || !canFinalize || busy} onClick={() => { if (match) void save(match.score1, match.score2, 'final') }}><Trophy size={20} /> Finalize winner {leader ? `· ${leader.teamName}` : ''}</button>}
      {!canFinalize && match?.status !== 'final' && <p className="score-hint">Reach {data.pointsToWin} points with a {data.winBy}-point lead to finalize. Past {data.pointsToWin}, the game ends as soon as the lead is {data.winBy}.</p>}
    </> : <div className="score-loading">{invalidScoreKey ? 'This scoring QR link is incomplete.' : error || 'Loading the match...'}</div>}
  </div></main>
}
