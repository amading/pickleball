import { ArrowLeft, CheckCircle2, Minus, Plus, RefreshCw, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import './liveScoring.css'
import { avatarSrc } from './liveTypes'
import { authHeaders, readToken } from './adminApi'

type Team = { id: string; teamName: string; players: { name: string; photo: string }[] }
type Match = { id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; game?: number; team1: string | null; team2: string | null; score1: number; score2: number; status: 'scheduled' | 'live' | 'final' | 'bye'; winner: string | null; version: number }
type MatchResponse = { categoryId: string; categoryTitle: string; pointsToWin: number; winBy: number; match: Match; team1: Team | null; team2: Team | null }

// Mirrors the server rule: reach the target by winBy, and past the target the lead is exactly winBy (13-11, never 15-2).
function validFinal(first: number, second: number, pointsToWin: number, winBy: number) {
  const high = Math.max(first, second)
  const margin = Math.abs(first - second)
  return high >= pointsToWin && margin >= winBy && (high === pointsToWin || margin === winBy)
}

export default function LiveScoring({ scoreKey }: { scoreKey: string }) {
  const [categoryId, matchId, token] = scoreKey.split('.')
  const [data, setData] = useState<MatchResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshIndex, setRefreshIndex] = useState(0)
  // Signed-in organizers may correct or reopen final scores from this page.
  const adminToken = readToken()
  const invalidScoreKey = !categoryId || !matchId || !token

  useEffect(() => {
    if (invalidScoreKey) return
    let active = true
    async function loadMatch() {
      try {
        const response = await fetch(`/api/categories/${categoryId}/matches/${matchId}`, { cache: 'no-cache' })
        const value = await response.json().catch(() => null)
        if (!value) throw new Error('The tournament server is not responding. Scores will sync when it is back.')
        if (!response.ok) throw new Error(value.error || 'Match not found.')
        if (active) { setData(value); setError('') }
      } catch (problem) { if (active) setError((problem as Error).message) }
    }
    void loadMatch()
    const timer = window.setInterval(() => { if (!busy) void loadMatch() }, 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [categoryId, matchId, invalidScoreKey, busy, refreshIndex])

  async function save(score1: number, score2: number, status: 'live' | 'final') {
    if (!data || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/categories/${categoryId}/matches/${matchId}/score`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-score-token': token, ...authHeaders(adminToken) },
        body: JSON.stringify({ score1, score2, status, version: data.match.version }),
      })
      const value = await response.json().catch(() => null)
      if (!value) throw new Error('Score not saved: the tournament server is not responding.')
      if (!response.ok) throw new Error(value.error || 'Score could not be saved.')
      setData((current) => current ? { ...current, match: value } : current)
      if (status === 'final') setRefreshIndex((current) => current + 1)
    } catch (problem) { setError((problem as Error).message); setRefreshIndex((current) => current + 1) }
    finally { setBusy(false) }
  }

  const match = data?.match
  const canScore = Boolean(token) && Boolean(data?.team1 && data.team2) && (match?.status !== 'final' || Boolean(adminToken)) && match?.status !== 'bye'
  const leader = match && match.score1 !== match.score2 ? (match.score1 > match.score2 ? data?.team1 : data?.team2) : null
  const finalWinner = match?.winner === data?.team1?.id ? data?.team1 : match?.winner === data?.team2?.id ? data?.team2 : null
  const canFinalize = Boolean(match && validFinal(match.score1, match.score2, data?.pointsToWin ?? 11, data?.winBy ?? 2))
  return <main className="score-page"><div className="score-shell"><header className="score-top"><a href={`/?register=${categoryId}`}><ArrowLeft size={17} /> Tournament page</a><img className="score-brand-logo" src="/pbb-logo.webp" alt="PBB Pickleball" width="600" height="400" /></header>
    {data ? <><div className="score-event"><span className="score-kicker">SCANNED MATCH · LIVE SCORING</span><h1>{data.categoryTitle}</h1><p>{match?.stage === 'pool' ? `${match.pool} · Game ${match.game}` : `Playoff · Round ${match?.round}`} <span>•</span> {match?.court}</p></div>
      <div className="score-status-line"><span className={`score-status ${match?.status}`}><i /> {match?.status === 'final' ? 'FINAL RESULT' : match?.status === 'live' ? 'MATCH IN PROGRESS' : 'READY TO PLAY'}</span><button type="button" onClick={() => setRefreshIndex((current) => current + 1)}><RefreshCw size={15} /> Sync</button></div>
      {finalWinner && <div className="score-winner-banner"><Trophy size={21} /><span>WINNER LOCKED</span><strong>{finalWinner.teamName}</strong></div>}
      <div className="score-versus">{([data.team1, data.team2] as const).map((team, index) => {
        const teamScore = index === 0 ? match?.score1 ?? 0 : match?.score2 ?? 0
        return <section className={`score-team-card ${match?.winner === team?.id ? 'winner' : ''} ${leader?.id === team?.id && match?.status !== 'final' ? 'leading' : ''}`} key={index}>
          <div className="score-team-head"><div className="score-photos">{team?.players.map((player) => <img src={avatarSrc(player.name, player.photo)} alt={player.name} key={player.name} />)}</div><span>TEAM {index + 1}</span></div>
          <h2>{team?.teamName || 'Waiting for opponent'}</h2>
          <div className="score-player-list">{team?.players.map((player) => <div key={player.name}><img src={avatarSrc(player.name, player.photo)} alt="" /><span>{player.name}</span></div>)}</div>
          <div className="score-number">{teamScore}</div>
          {match?.winner === team?.id && <div className="score-winner"><Trophy size={16} /> WINNER</div>}
          {canScore && <div className="score-controls"><button type="button" aria-label={`Remove point from ${team?.teamName}`} disabled={busy || teamScore === 0} onClick={() => void save(index === 0 ? Math.max(0, match!.score1 - 1) : match!.score1, index === 1 ? Math.max(0, match!.score2 - 1) : match!.score2, 'live')}><Minus size={20} /></button><button type="button" aria-label={`Add point to ${team?.teamName}`} disabled={busy} onClick={() => void save(index === 0 ? match!.score1 + 1 : match!.score1, index === 1 ? match!.score2 + 1 : match!.score2, 'live')}><Plus size={22} /></button></div>}
        </section>
      })}</div>
      <div className="score-rule-bar"><span>GAME RULE</span><strong>First to {data.pointsToWin} · Win by {data.winBy}</strong><p>Each point saves instantly and appears on the organizer and player pages.</p></div>
      {error && <div className="score-error">{error}</div>}
      {match?.status === 'final' ? <div className="score-final"><CheckCircle2 size={20} /> Result saved. Winner is {finalWinner?.teamName || 'confirmed'}.{match.stage === 'playoff' ? ' Bracket advanced automatically.' : ' Standings updated automatically.'}{adminToken && <button type="button" disabled={busy} onClick={() => void save(match.score1, match.score2, 'live')}>Reopen as organizer</button>}</div> : <button className="score-finish" type="button" disabled={!canScore || !canFinalize || busy} onClick={() => { if (match) void save(match.score1, match.score2, 'final') }}><Trophy size={20} /> Finalize winner {leader ? `· ${leader.teamName}` : ''}</button>}
      {!canFinalize && match?.status !== 'final' && <p className="score-hint">Reach {data.pointsToWin} points with a {data.winBy}-point lead to finalize. Past {data.pointsToWin}, the game ends as soon as the lead is {data.winBy}.</p>}
    </> : <div className="score-loading">{invalidScoreKey ? 'This scoring QR link is incomplete.' : error || 'Loading the match...'}</div>}
  </div></main>
}
