import { CalendarClock, Check, CircleDot, Search, Trophy, Users } from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import './poolStage.css'

type Pool = { id: string; color: string; teams: string[] }
type ScheduledMatch = { game: number; court: string; pool: string; team1: string; team2: string; round: number }
type Props = { pools: Pool[]; schedule: ScheduledMatch[]; scheduleMode: 'balanced' | 'manual' }

const resultsKey = 'rally-hq-pool-results-v1'

function matchKey(match: ScheduledMatch) {
  return `${match.pool}::${[match.team1, match.team2].sort().join('::')}`
}

function readResults(): Record<string, string> {
  try {
    const saved = window.localStorage.getItem(resultsKey)
    const parsed: unknown = saved ? JSON.parse(saved) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

export default function PoolStage({ pools, schedule, scheduleMode }: Props) {
  const [selectedPool, setSelectedPool] = useState('Pool A')
  const [teamQuery, setTeamQuery] = useState('')
  const [results, setResults] = useState<Record<string, string>>(readResults)
  const pool = pools.find((item) => item.id === selectedPool) ?? pools[0]
  const allTeams = pools.flatMap((item) => item.teams)
  const selectedTeam = allTeams.find((name) => name.toLowerCase() === teamQuery.trim().toLowerCase())
  const poolMatches = schedule.filter((match) => match.pool === pool.id).sort((a, b) => a.game - b.game)
  const completedCount = poolMatches.filter((match) => results[matchKey(match)]).length
  const nextMatch = poolMatches.find((match) => !results[matchKey(match)] && (!selectedTeam || match.team1 === selectedTeam || match.team2 === selectedTeam))
  const opponent = nextMatch && selectedTeam ? (nextMatch.team1 === selectedTeam ? nextMatch.team2 : nextMatch.team1) : undefined

  useLayoutEffect(() => {
    window.localStorage.setItem(resultsKey, JSON.stringify(results))
  }, [results])

  useEffect(() => {
    const syncResults = (event: StorageEvent) => {
      if (event.key === resultsKey) setResults(readResults())
    }
    window.addEventListener('storage', syncResults)
    return () => window.removeEventListener('storage', syncResults)
  }, [])

  const standings = (() => {
    const rows = pool.teams.map((name, seed) => ({ name, seed: seed + 1, wins: 0, losses: 0 }))
    const byName = new Map(rows.map((row) => [row.name, row]))
    for (const match of poolMatches) {
      const winner = results[matchKey(match)]
      if (!winner) continue
      const loser = winner === match.team1 ? match.team2 : match.team1
      const winningRow = byName.get(winner)
      const losingRow = byName.get(loser)
      if (winningRow && losingRow) {
        winningRow.wins += 1
        losingRow.losses += 1
      }
    }
    return rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.seed - b.seed)
  })()

  function chooseWinner(match: ScheduledMatch, winner: string) {
    setResults((current) => ({ ...current, [matchKey(match)]: winner }))
  }

  function clearWinner(match: ScheduledMatch) {
    setResults((current) => {
      const updated = { ...current }
      delete updated[matchKey(match)]
      return updated
    })
  }

  return (
    <section className="panel pool-stage-panel">
      <header className="pool-stage-header">
        <div>
          <span className="eyebrow">ACTUAL FORMAT SHOWN IN THE SHEETS</span>
          <h2>Pool stage <span>·</span> Round robin</h2>
          <p>Teams play every other team <strong>inside their own pool</strong>. Pool A teams do not face Pool B teams during this stage. Game numbers below follow the selected {scheduleMode === 'manual' ? 'sheet order' : 'proposed smart schedule'}.</p>
        </div>
        <span className="pool-stage-format"><CircleDot size={17} /> 9 POOLS · 3 COURTS</span>
      </header>

      <div className="pool-stage-facts">
        <div><Users size={18} /><strong>5</strong><span>teams per pool</span></div>
        <div><CalendarClock size={18} /><strong>4</strong><span>games per team</span></div>
        <div><Trophy size={18} /><strong>10</strong><span>games per pool</span></div>
        <p>All 9 pools make <b>90 pool games</b>. Each court rotates among its 3 assigned pools.</p>
      </div>

      <div className="pool-stage-controls">
        <div className="pool-stage-tabs" role="tablist" aria-label="Choose pool">
          {pools.map((item) => (
            <button type="button" role="tab" aria-selected={item.id === pool.id} className={item.id === pool.id ? 'active' : ''} key={item.id} onClick={() => { setSelectedPool(item.id); setTeamQuery('') }}>
              {item.id.replace('Pool ', '')}
            </button>
          ))}
        </div>
        <label className="pool-team-search"><Search size={17} /><input aria-label="Find a pool team" list="all-pool-teams" placeholder="Find your team..." value={teamQuery} onChange={(event) => {
          const value = event.target.value
          setTeamQuery(value)
          const foundPool = pools.find((item) => item.teams.some((name) => name.toLowerCase() === value.trim().toLowerCase()))
          if (foundPool) setSelectedPool(foundPool.id)
        }} /><datalist id="all-pool-teams">{allTeams.map((name) => <option value={name} key={name} />)}</datalist></label>
      </div>

      <div className="pool-stage-next" aria-live="polite">
        <div><span className="pool-live-dot" /><small>{selectedTeam ? 'YOUR NEXT SCHEDULED POOL GAME' : `${pool.id.toUpperCase()} · NEXT UNRECORDED GAME`}</small></div>
        <strong>{nextMatch ? selectedTeam ? `${selectedTeam} vs ${opponent}` : `${nextMatch.team1} vs ${nextMatch.team2}` : selectedTeam ? 'No remaining pool games' : 'All pool games recorded'}</strong>
        <span>{nextMatch ? `${nextMatch.court} · Game ${nextMatch.game}` : `${completedCount} of 10 results recorded`}</span>
      </div>

      <div className="pool-stage-content">
        <div className="pool-games-column">
          <div className="pool-stage-section-title"><div><span className="eyebrow">{pool.id.toUpperCase()} MATCHUPS</span><h3>Everyone plays everyone.</h3></div><span>{completedCount} / 10 results</span></div>
          <div className="pool-match-list">
            {poolMatches.map((match) => {
              const winner = results[matchKey(match)]
              return <article className="pool-match-card" key={matchKey(match)}>
                <div className="pool-match-head"><span>GAME {match.game} <i>·</i> {match.court.toUpperCase()}</span>{winner ? <b className="pool-result-done"><Check size={12} /> RESULT</b> : <b className="pool-result-pending">TO PLAY</b>}</div>
                <div className="pool-match-teams">
                  {[match.team1, match.team2].map((team) => <button type="button" key={team} className={winner === team ? 'chosen' : winner ? 'lost' : ''} aria-pressed={winner === team} onClick={() => chooseWinner(match, team)}><span>{team}</span>{winner === team && <small>WINNER</small>}</button>)}
                </div>
                {winner && <button type="button" className="pool-clear-result" onClick={() => clearWinner(match)}>Clear result</button>}
              </article>
            })}
          </div>
        </div>
        <aside className="pool-standings">
          <div className="pool-stage-section-title"><div><span className="eyebrow">LIVE TABLE</span><h3>{pool.id} standings</h3></div></div>
          <div className="standings-head"><span>TEAM</span><span>W</span><span>L</span></div>
          {standings.map((team, index) => <div className="standings-row" key={team.name}><span className="standings-rank">{index + 1}</span><strong title={team.name}>{team.name}</strong><b>{team.wins}</b><span>{team.losses}</span></div>)}
          <p>Standings are provisional. The screenshots do not specify playoff qualifiers or tiebreak rules.</p>
        </aside>
      </div>
    </section>
  )
}
