import { CalendarClock, CircleDot, Search, Trophy, Users } from 'lucide-react'
import { useState } from 'react'
import './poolStage.css'

type Pool = { id: string; color: string; teams: string[] }
type ScheduledMatch = { game: number; court: string; pool: string; team1: string; team2: string; round: number }
type Props = { pools: Pool[]; schedule: ScheduledMatch[]; scheduleMode: 'balanced' | 'manual' }

// Read-only view of the supplied Regall sheet. Results are never recorded here: real winners come
// from saved final scores in organizer-created categories.
export default function PoolStage({ pools, schedule, scheduleMode }: Props) {
  const [selectedPool, setSelectedPool] = useState(pools[0]?.id ?? '')
  const [teamQuery, setTeamQuery] = useState('')
  const pool = pools.find((item) => item.id === selectedPool) ?? pools[0]
  const allTeams = pools.flatMap((item) => item.teams)
  const selectedTeam = allTeams.find((name) => name.toLowerCase() === teamQuery.trim().toLowerCase())
  const poolMatches = schedule.filter((match) => match.pool === pool.id).sort((a, b) => a.game - b.game)
  const shownMatches = selectedTeam ? poolMatches.filter((match) => match.team1 === selectedTeam || match.team2 === selectedTeam) : poolMatches
  const firstMatch = shownMatches[0]
  const gamesPerTeam = pool.teams.length - 1

  return (
    <section className="panel pool-stage-panel">
      <header className="pool-stage-header">
        <div>
          <span className="eyebrow">SUPPLIED SHEET · REFERENCE ONLY</span>
          <h2>Pool stage <span>·</span> Round robin</h2>
          <p>Teams play every other team <strong>inside their own pool</strong>. Game numbers follow the selected {scheduleMode === 'manual' ? 'sheet order' : 'proposed smart schedule'}. No results are recorded here.</p>
        </div>
        <span className="pool-stage-format"><CircleDot size={17} /> {pools.length} POOLS</span>
      </header>

      <div className="pool-stage-facts">
        <div><Users size={18} /><strong>{pool.teams.length}</strong><span>teams per pool</span></div>
        <div><CalendarClock size={18} /><strong>{gamesPerTeam}</strong><span>games per team</span></div>
        <div><Trophy size={18} /><strong>{poolMatches.length}</strong><span>games per pool</span></div>
        <p>All {pools.length} pools make <b>{schedule.length} pool games</b>. Each court rotates among its assigned pools.</p>
      </div>

      <div className="pool-stage-controls">
        <div className="pool-stage-tabs" role="tablist" aria-label="Choose pool">
          {pools.map((item) => (
            <button type="button" role="tab" aria-selected={item.id === pool.id} className={item.id === pool.id ? 'active' : ''} key={item.id} onClick={() => { setSelectedPool(item.id); setTeamQuery('') }}>
              {item.id.replace('Pool ', '')}
            </button>
          ))}
        </div>
        <label className="pool-team-search"><Search size={17} /><input aria-label="Find a pool team" list="all-pool-teams" placeholder="Find a team..." value={teamQuery} onChange={(event) => {
          const value = event.target.value
          setTeamQuery(value)
          const foundPool = pools.find((item) => item.teams.some((name) => name.toLowerCase() === value.trim().toLowerCase()))
          if (foundPool) setSelectedPool(foundPool.id)
        }} /><datalist id="all-pool-teams">{allTeams.map((name) => <option value={name} key={name} />)}</datalist></label>
      </div>

      <div className="pool-stage-next" aria-live="polite">
        <div><span className="pool-live-dot" /><small>{selectedTeam ? 'FIRST SCHEDULED GAME' : `${pool.id.toUpperCase()} · OPENING GAME`}</small></div>
        <strong>{firstMatch ? `${firstMatch.team1} vs ${firstMatch.team2}` : 'No games scheduled'}</strong>
        <span>{firstMatch ? `${firstMatch.court} · Game ${firstMatch.game}` : ''}</span>
      </div>

      <div className="pool-stage-content">
        <div className="pool-games-column">
          <div className="pool-stage-section-title"><div><span className="eyebrow">{selectedTeam ? selectedTeam.toUpperCase() : `${pool.id.toUpperCase()} MATCHUPS`}</span><h3>Everyone plays everyone.</h3></div><span>{shownMatches.length} games</span></div>
          <div className="pool-match-list">
            {shownMatches.map((match) => (
              <article className="pool-match-card" key={`${match.court}-${match.game}`}>
                <div className="pool-match-head"><span>GAME {match.game} <i>·</i> {match.court.toUpperCase()}</span><b className="pool-result-pending">SHEET</b></div>
                <div className="pool-match-teams">
                  {[match.team1, match.team2].map((team) => <button type="button" disabled key={team} className={team === selectedTeam ? 'chosen' : ''}><span>{team}</span></button>)}
                </div>
              </article>
            ))}
          </div>
        </div>
        <aside className="pool-standings">
          <div className="pool-stage-section-title"><div><span className="eyebrow">LINE-UP</span><h3>{pool.id} teams</h3></div></div>
          <div className="standings-head"><span>TEAM</span><span>GP</span><span /></div>
          {pool.teams.map((team, index) => <div className="standings-row" key={team}><span className="standings-rank">{index + 1}</span><strong title={team}>{team}</strong><b>{gamesPerTeam}</b><span /></div>)}
          <p>The supplied sheets list pools and schedules only. They do not define results, qualifiers, or tiebreaks.</p>
        </aside>
      </div>
    </section>
  )
}
