import { ArrowLeft, Check, CheckCircle2, RefreshCw, RotateCcw, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import './liveScoring.css'
import './rallyMinimal.css'
import { authHeaders, readToken } from './adminApi'

type Team = { id: string; teamName: string; players: { name: string; photo: string }[] }
type ScoreEvent = { id: string; action?: 'point' | 'lost-serve' | 'undo' | 'set-serve'; team: 1 | 2 | null; change: number; score1: number; score2: number; serveTeam?: 1 | 2; serveNumber?: 1 | 2; at: string }
type Snapshot = { score1: number; score2: number; status: ScoringMatch['status']; serveTeam: 1 | 2; serveNumber: 1 | 2 }
export type ScoringMatch = { id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; game?: number; team1: string | null; team2: string | null; score1: number; score2: number; status: 'scheduled' | 'live' | 'final' | 'bye'; winner: string | null; version: number; serveTeam: 1 | 2; serveNumber: 1 | 2; canUndo?: boolean; scoreEvents?: ScoreEvent[]; demoHistory?: Snapshot[] }
export type ScoringResponse = { categoryId: string; categoryTitle: string; format: 'doubles' | 'mixed-doubles' | 'singles'; pointsToWin: number; winBy: number; match: ScoringMatch; team1: Team | null; team2: Team | null }
type RallyAction = 'point' | 'lost-serve' | 'undo' | 'set-serve'

function validFinal(first: number, second: number, target: number, winBy: number) {
  const high = Math.max(first, second)
  const margin = Math.abs(first - second)
  return high >= target && margin >= winBy && (high === target || margin === winBy)
}

function demoRally(match: ScoringMatch, action: RallyAction, format: ScoringResponse['format'], team?: 1 | 2, serverNumber?: 1 | 2): ScoringMatch {
  const history = [...(match.demoHistory ?? [])]
  const next = { ...match, scoreEvents: [...(match.scoreEvents ?? [])] }
  let eventTeam: 1 | 2 | null = null
  let change = 0
  if (action === 'undo') {
    const previous = history.pop()
    if (!previous) throw new Error('No action to undo.')
    Object.assign(next, previous)
  } else {
    history.push({ score1: match.score1, score2: match.score2, status: match.status, serveTeam: match.serveTeam, serveNumber: match.serveNumber })
    if (action === 'point') {
      if (team !== match.serveTeam) throw new Error('Only the serving team can score.')
      if (team === 1) next.score1 += 1
      else next.score2 += 1
      eventTeam = team
      change = 1
    } else if (action === 'lost-serve') {
      if (format !== 'singles' && match.serveNumber === 1) next.serveNumber = 2
      else { next.serveTeam = match.serveTeam === 1 ? 2 : 1; next.serveNumber = 1 }
      eventTeam = next.serveTeam
    } else if (team && serverNumber) {
      next.serveTeam = team
      next.serveNumber = serverNumber
      eventTeam = team
    }
    next.status = 'live'
  }
  next.demoHistory = history
  next.canUndo = history.length > 0
  next.version += 1
  next.scoreEvents!.push({ id: crypto.randomUUID(), action, team: eventTeam, change, score1: next.score1, score2: next.score2, serveTeam: next.serveTeam, serveNumber: next.serveNumber, at: new Date().toISOString() })
  return next
}

export default function LiveScoring({ scoreKey, stationToken, onBack, demoData, onDemoSave }: { scoreKey: string; stationToken?: string; onBack?: () => void; demoData?: ScoringResponse; onDemoSave?: (match: ScoringMatch) => void }) {
  const [categoryId, matchId, token] = scoreKey.split('.')
  const [data, setData] = useState<ScoringResponse | null>(demoData ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lastSaved, setLastSaved] = useState(false)
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [dismissedVersion, setDismissedVersion] = useState<number | null>(null)
  const [showCorrection, setShowCorrection] = useState(false)
  const adminToken = readToken()
  const invalidScoreKey = !categoryId || !matchId || !token

  useEffect(() => {
    if (invalidScoreKey || demoData) return
    let active = true
    async function loadMatch() {
      try {
        const response = await fetch(`/api/categories/${categoryId}/matches/${matchId}`, { cache: 'no-cache', headers: { 'x-score-token': token, ...(stationToken ? { 'x-station-token': stationToken } : {}), ...authHeaders(adminToken) } })
        const value = await response.json().catch(() => null)
        if (!value) throw new Error('The tournament server is not responding.')
        if (!response.ok) throw new Error(value.error || 'Match not found.')
        if (active) { setData(value); setError('') }
      } catch (problem) { if (active) setError((problem as Error).message) }
    }
    void loadMatch()
    const timer = window.setInterval(() => { if (!busy) void loadMatch() }, 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [categoryId, matchId, token, stationToken, adminToken, invalidScoreKey, demoData, busy, refreshIndex])

  async function rally(action: RallyAction, team?: 1 | 2, serveNumber?: 1 | 2) {
    if (!data || busy) return
    setBusy(true); setError(''); setLastSaved(false)
    try {
      let updated: ScoringMatch
      if (demoData) updated = demoRally(data.match, action, data.format, team, serveNumber)
      else {
        const response = await fetch(`/api/categories/${categoryId}/matches/${matchId}/rally`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-score-token': token, ...(stationToken ? { 'x-station-token': stationToken } : {}), ...authHeaders(adminToken) },
          body: JSON.stringify({ action, team, serveNumber, version: data.match.version }),
        })
        const value = await response.json().catch(() => null)
        if (!value) throw new Error('Score was not saved. Check the tournament server.')
        if (!response.ok) throw new Error(value.error || 'Action could not be saved.')
        updated = value
      }
      setData((current) => current ? { ...current, match: updated } : current)
      onDemoSave?.(updated)
      setLastSaved(true)
      setShowCorrection(false)
      if ('vibrate' in navigator) navigator.vibrate(25)
    } catch (problem) { setError((problem as Error).message); setRefreshIndex((current) => current + 1) }
    finally { setBusy(false) }
  }

  async function finalize() {
    if (!data || busy) return
    setBusy(true); setError('')
    try {
      let updated: ScoringMatch
      if (demoData) updated = { ...data.match, status: 'final', winner: data.match.score1 > data.match.score2 ? data.team1?.id ?? null : data.team2?.id ?? null, version: data.match.version + 1 }
      else {
        const response = await fetch(`/api/categories/${categoryId}/matches/${matchId}/score`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-score-token': token, ...(stationToken ? { 'x-station-token': stationToken } : {}), ...authHeaders(adminToken) },
          body: JSON.stringify({ score1: data.match.score1, score2: data.match.score2, status: 'final', version: data.match.version }),
        })
        const value = await response.json().catch(() => null)
        if (!value) throw new Error('Result was not saved. Check the tournament server.')
        if (!response.ok) throw new Error(value.error || 'Result could not be saved.')
        updated = value
      }
      setData((current) => current ? { ...current, match: updated } : current)
      onDemoSave?.(updated)
      setRefreshIndex((current) => current + 1)
    } catch (problem) { setError((problem as Error).message); setRefreshIndex((current) => current + 1) }
    finally { setBusy(false) }
  }

  const match = data?.match
  const canScore = Boolean(token && data?.team1 && data.team2 && match?.status !== 'final' && match?.status !== 'bye')
  const canFinalize = Boolean(match && validFinal(match.score1, match.score2, data?.pointsToWin ?? 11, data?.winBy ?? 2))
  const finishPrompt = canFinalize && match?.status !== 'final' && dismissedVersion !== match?.version
  const servingTeam = match?.serveTeam ?? 1
  const servingScore = servingTeam === 1 ? match?.score1 ?? 0 : match?.score2 ?? 0
  const receivingScore = servingTeam === 1 ? match?.score2 ?? 0 : match?.score1 ?? 0
  const finalWinner = match?.winner === data?.team1?.id ? data?.team1 : match?.winner === data?.team2?.id ? data?.team2 : null
  const nextServeTeam = data?.format === 'singles' || match?.serveNumber === 2 ? (servingTeam === 1 ? data?.team2 : data?.team1) : (servingTeam === 1 ? data?.team1 : data?.team2)
  const nextServeNumber = data?.format === 'singles' || match?.serveNumber === 2 ? 1 : 2
  const nearTarget = (score: number) => score >= (data?.pointsToWin ?? 11) - 1

  return <main className="score-page rally-page"><div className="score-shell rally-shell">
    {data && match ? <>
      <div className="rally-heading"><div className="rally-heading-line">{onBack ? <button type="button" className="rally-back" aria-label="Back to games" onClick={onBack}><ArrowLeft size={21} /></button> : <a className="rally-back" aria-label="Back to tournament" href={`/?register=${categoryId}`}><ArrowLeft size={21} /></a>}<h1>{match.stage === 'pool' ? `Game ${match.game}` : `Playoff · Round ${match.round}`}</h1><span className={`rally-state ${match.status}`}>{match.status === 'final' ? 'FINAL' : match.status === 'live' ? 'LIVE' : 'READY'}</span></div><p>{match.court} · {match.pool ?? data.categoryTitle} · To {data.pointsToWin}</p>{demoData && <span className="rally-demo">DEMO · NO REAL RESULTS</span>}</div>
      <div className="rally-call"><small aria-live="polite">{busy ? '…' : lastSaved ? '✓' : ''}</small><strong>{servingScore} – {receivingScore}{data.format !== 'singles' && <> – <em>{match.serveNumber}</em></>}</strong>{!demoData && <button type="button" aria-label="Refresh score" onClick={() => setRefreshIndex((value) => value + 1)}><RefreshCw size={16} /></button>}</div>
      {finalWinner && <div className="rally-winner"><Trophy size={19} /> Winner: <strong>{finalWinner.teamName}</strong></div>}
      <div className="rally-scoreboard">{([data.team1, data.team2] as const).map((team, index) => {
        const side = (index + 1) as 1 | 2
        const score = side === 1 ? match.score1 : match.score2
        const serving = servingTeam === side
        const canTap = canScore && serving && !canFinalize && !busy && score < 999
        return <section className={`rally-side ${serving && match.status !== 'final' ? 'serving' : ''} ${finalWinner?.id === team?.id ? 'winner' : ''}`} key={side}>
          <div className="rally-side-heading">{serving && match.status !== 'final' && <span>● SERVING</span>}</div>
          <h2>{team?.teamName || 'Waiting for opponent'}</h2>
          <button type="button" className={`rally-score-number ${score >= 100 ? 'triple' : ''} ${nearTarget(score) && !canFinalize ? 'game-point' : ''} ${canFinalize && score > (side === 1 ? match.score2 : match.score1) ? 'winning' : ''}`} aria-label={`Score point for ${team?.teamName || `Team ${side}`}`} disabled={!canTap} onClick={() => void rally('point', side)}>{score}</button>
          <small className="rally-tap-hint">{match.status === 'final' ? 'FINAL' : canFinalize ? 'MATCH POINT' : serving ? 'TAP +1' : ''}</small>
        </section>
      })}</div>
      <button type="button" className="rally-serve-zone" aria-label={`Change serve from ${servingTeam === 1 ? data.team1?.teamName : data.team2?.teamName}, server ${match.serveNumber}, to ${nextServeTeam?.teamName}, server ${nextServeNumber}`} disabled={!canScore || canFinalize || busy} onClick={() => void rally('lost-serve')}><span className="rally-serve-team">{servingTeam === 1 ? data.team1?.teamName : data.team2?.teamName}</span><span className="rally-server-number">{match.serveNumber}</span><span className="rally-serve-next">→ {nextServeTeam?.teamName} · {nextServeNumber}</span></button>
      {canScore && !canFinalize && <><button className="rally-correct-toggle" type="button" onClick={() => setShowCorrection((shown) => !shown)}>Fix serve</button>{showCorrection && <div className="rally-correction"><span>SELECT THE ACTUAL SERVER</span><div>{([1, 2] as const).flatMap((team) => (data.format === 'singles' ? [1] : [1, 2]).map((number) => <button type="button" key={`${team}-${number}`} disabled={busy || (match.serveTeam === team && match.serveNumber === number)} onClick={() => void rally('set-serve', team, number as 1 | 2)}>Team {team} · Server {number}</button>))}</div></div>}</>}
      <div className="rally-tracker"><div className="rally-tracker-heading"><span>POINTS</span><strong>To {data.pointsToWin} · +{data.winBy}</strong></div>{([data.team1, data.team2] as const).map((team, index) => {
        const score = index === 0 ? match.score1 : match.score2
        return <div className="rally-tracker-row" key={index}><span>{team?.teamName || `Team ${index + 1}`}</span><div>{Array.from({ length: score }, (_, point) => <b className={point + 1 >= data.pointsToWin - 1 ? 'near' : ''} key={point}><Check size={11} /></b>)}</div><strong>{score}</strong></div>
      })}</div>
      {error && <div className="score-error">{error}</div>}
      <div className="rally-footer"><button type="button" disabled={!canScore || !match.canUndo || busy} onClick={() => void rally('undo')}><RotateCcw size={20} /> Undo</button>{canFinalize && match.status !== 'final' && <button type="button" className="rally-end" onClick={() => setDismissedVersion(null)}><Trophy size={18} /> End game</button>}{match.status === 'final' && <div><CheckCircle2 size={19} /> Result confirmed{!demoData && match.stage === 'playoff' ? ' · bracket advanced' : ''}</div>}</div>
      {finishPrompt && <div className="rally-dialog-backdrop"><div className="rally-dialog" role="dialog" aria-modal="true" aria-labelledby="rally-dialog-title"><span>MATCH POINT</span><h2 id="rally-dialog-title">End this game?</h2><p>{match.score1}–{match.score2} meets the organizer’s rule: first to {data.pointsToWin}, win by {data.winBy}. Confirm the winner to update the tournament.</p><strong>{match.score1 > match.score2 ? data.team1?.teamName : data.team2?.teamName}</strong><div><button type="button" onClick={() => setDismissedVersion(match.version)}>Review score</button><button type="button" disabled={busy} onClick={() => void finalize()}>Confirm winner</button></div></div></div>}
    </> : <div className="score-loading">{invalidScoreKey ? 'This scoring QR link is incomplete.' : error || 'Loading match…'}</div>}
  </div></main>
}
