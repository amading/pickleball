import { Activity, CheckCircle2, Info, ShieldCheck, Shuffle } from 'lucide-react'
import { useMemo, useState } from 'react'
import PoolStage from './PoolStage'
import './liveViews.css'

// The supplied Regall sheet. Kept apart from organizer categories: it is a line-up and schedule
// reference only, with no results, seeds, or winners.
type Pool = { id: string; color: string; teams: string[] }
type ScheduledMatch = { game: number; court: string; pool: string; team1: string; team2: string; round: number }
type CourtPlan = { court: string; pools: string[] }
type View = 'pools' | 'matchups' | 'schedule' | 'fairness'

const regallPools: Pool[] = [
  { id: 'Pool A', color: '#1471a8', teams: ['gulas team', 'PCP: Raymond-Wen', 'CNLPWS SMASH 2.0', 'Rojan-Gerald', 'Kepe-Bryan'] },
  { id: 'Pool B', color: '#2f8b58', teams: ['Perse Picklers', 'iamMIKA Inc. Pickleball', 'Tribu-Rat', 'Lhey-Ann & John', 'Gichelle-Jessa'] },
  { id: 'Pool C', color: '#f0bd2f', teams: ['team duday', 'Dimple-Amads', 'Gwenn-Jhasmine', 'Dorence-Emman', 'iamMIKA Inc. Pickleball (C)'] },
  { id: 'Pool D', color: '#f37b19', teams: ['OFF COURT', 'PBPC - Klent x Vince', 'Team hapak', 'Rema-Igi', 'IamMika Inc. Pickleball Team'] },
  { id: 'Pool E', color: '#9b2fc1', teams: ['Perse Picklers (E)', 'HAPAKRA', 'PCP - Nino & Erica', 'dilldou', 'Banny-Gerald'] },
  { id: 'Pool F', color: '#1676a6', teams: ['Hoi walang kanin bossing', 'PCP_Bryand&Janinne', 'Kaye-Jelou', 'Jake-Meghan', 'Pipo-Lemon'] },
  { id: 'Pool G', color: '#2f8751', teams: ['Crown Regal', 'Antonite', 'PCP:Potpot-Macmon', 'Kert-VJ', 'Entice-Melkiens'] },
  { id: 'Pool H', color: '#793ccc', teams: ['Zeanly Majnutganon Y.', 'JUC PC BRIX AND NYGEL', 'iamMika Inc. Pickleball (H)', 'Oweng-Atchiel', 'SJDB PICKLEBALL CLUB'] },
  { id: 'Pool I', color: '#168f8a', teams: ['Yohoo!', 'PCP_Anton&Jay Ann', 'San Jose De Buan Pickleball', 'Jorenz-Angelo', 'Josh-Alex'] },
]

const courtPlans: CourtPlan[] = [
  { court: 'Court 1', pools: ['Pool A', 'Pool B', 'Pool C'] },
  { court: 'Court 2', pools: ['Pool D', 'Pool E', 'Pool F'] },
  { court: 'Court 3', pools: ['Pool G', 'Pool H', 'Pool I'] },
]

const poolMap = new Map(regallPools.map((pool) => [pool.id, pool]))

function poolPairs(poolId: string) {
  const pool = poolMap.get(poolId)
  if (!pool) throw new Error(`Missing pool ${poolId}`)
  const matches: { pool: string; team1: string; team2: string }[] = []
  for (let i = 0; i < pool.teams.length; i += 1) {
    for (let j = i + 1; j < pool.teams.length; j += 1) matches.push({ pool: pool.id, team1: pool.teams[i], team2: pool.teams[j] })
  }
  return matches
}

function buildBalancedSchedule() {
  const schedule: ScheduledMatch[] = []
  for (const plan of courtPlans) {
    const remaining = plan.pools.flatMap(poolPairs)
    const lastPlayed = new Map<string, number>()
    const playCount = new Map<string, number>()
    let courtGame = 1
    while (remaining.length > 0) {
      let bestIndex = 0
      let bestScore = Number.NEGATIVE_INFINITY
      for (let index = 0; index < remaining.length; index += 1) {
        const match = remaining[index]
        const team1Rest = courtGame - (lastPlayed.get(match.team1) ?? -99)
        const team2Rest = courtGame - (lastPlayed.get(match.team2) ?? -99)
        const totalAppearances = (playCount.get(match.team1) ?? 0) + (playCount.get(match.team2) ?? 0)
        const samePoolAsPrevious = schedule.at(-1)?.court === plan.court && schedule.at(-1)?.pool === match.pool
        const recentPenalty = (team1Rest <= 2 ? 100 : 0) + (team2Rest <= 2 ? 100 : 0)
        const score = Math.min(team1Rest, team2Rest) * 5 - totalAppearances * 2 - recentPenalty - (samePoolAsPrevious ? 8 : 0) - index / 1000
        if (score > bestScore) { bestScore = score; bestIndex = index }
      }
      const [match] = remaining.splice(bestIndex, 1)
      schedule.push({ ...match, game: courtGame, court: plan.court, round: Math.ceil(courtGame / (plan.pools.length * 2)) })
      lastPlayed.set(match.team1, courtGame)
      lastPlayed.set(match.team2, courtGame)
      playCount.set(match.team1, (playCount.get(match.team1) ?? 0) + 1)
      playCount.set(match.team2, (playCount.get(match.team2) ?? 0) + 1)
      courtGame += 1
    }
  }
  return schedule
}

function buildSheetSchedule() {
  const schedule: ScheduledMatch[] = []
  for (const plan of courtPlans) {
    const matchesByPool = plan.pools.map(poolPairs)
    const maxMatches = Math.max(...matchesByPool.map((matches) => matches.length))
    let courtGame = 1
    for (let matchIndex = 0; matchIndex < maxMatches; matchIndex += 1) {
      for (const matches of matchesByPool) {
        const match = matches[matchIndex]
        if (!match) continue
        schedule.push({ ...match, game: courtGame, court: plan.court, round: Math.floor(matchIndex / 2) + 1 })
        courtGame += 1
      }
    }
  }
  return schedule
}

function getWaitStats(schedule: ScheduledMatch[]) {
  const appearances = new Map<string, number[]>()
  for (const match of schedule) {
    for (const team of [match.team1, match.team2]) {
      const key = `${match.court}::${team}`
      appearances.set(key, [...(appearances.get(key) ?? []), match.game])
    }
  }
  const gaps = [...appearances.entries()].flatMap(([key, games]) => games.slice(1).map((game, index) => ({
    team: key.split('::')[1], court: key.split('::')[0], from: games[index], to: game, gap: game - games[index] - 1,
  })))
  return {
    averageGap: Number((gaps.reduce((sum, gap) => sum + gap.gap, 0) / gaps.length).toFixed(1)),
    maxGap: Math.max(...gaps.map((gap) => gap.gap)),
    worst: [...gaps].sort((a, b) => b.gap - a.gap).slice(0, 5),
  }
}

export default function RegallReference() {
  const [mode, setMode] = useState<'balanced' | 'manual'>('balanced')
  const [view, setView] = useState<View>('pools')
  const [selectedCourt, setSelectedCourt] = useState('Court 1')
  const schedule = useMemo(() => (mode === 'balanced' ? buildBalancedSchedule() : buildSheetSchedule()), [mode])
  const stats = useMemo(() => getWaitStats(schedule), [schedule])
  const selectedMatches = schedule.filter((match) => match.court === selectedCourt)
  const totalTeams = regallPools.reduce((sum, pool) => sum + pool.teams.length, 0)
  const views: { id: View; label: string }[] = [{ id: 'pools', label: 'Pools' }, { id: 'matchups', label: 'Matchups' }, { id: 'schedule', label: 'Court order' }, { id: 'fairness', label: 'Rest check' }]

  return <>
    <div className="reference-banner"><Info size={17} /><span><strong>Reference only.</strong> This is the supplied Regall Showdown sheet: {regallPools.length} pools, {totalTeams} teams, {schedule.length} pool games on {courtPlans.length} courts. It has no scores or winners. Run real tournaments from <strong>Organizer</strong>; their results appear under Live board and Schedule.</span></div>
    <div className="bracket-view-switcher" aria-label="Reference view">
      <div className="bracket-view-tabs">{views.map((item) => <button type="button" className={view === item.id ? 'active' : ''} key={item.id} onClick={() => setView(item.id)}>{item.label}</button>)}</div>
      <div className="hero-actions" aria-label="Schedule order">
        <button type="button" className={mode === 'balanced' ? 'primary-btn' : 'ghost-btn'} onClick={() => setMode('balanced')}><ShieldCheck size={18} /> Smart order</button>
        <button type="button" className={mode === 'manual' ? 'primary-btn warning' : 'ghost-btn'} onClick={() => setMode('manual')}><Shuffle size={18} /> Sheet order</button>
      </div>
    </div>

    {view === 'pools' && <section className="panel lineup-panel">
      <div className="section-heading"><div><span className="eyebrow">Supplied pool line-up</span><h2>Newbie genderless category</h2></div><CheckCircle2 size={24} /></div>
      <div className="pool-grid">{regallPools.map((pool) => <article className="pool-card" key={pool.id}><h3 style={{ background: pool.color }}>{pool.id}</h3><ol>{pool.teams.map((team) => <li key={team}>{team}</li>)}</ol></article>)}</div>
    </section>}

    {view === 'matchups' && <PoolStage pools={regallPools} schedule={schedule} scheduleMode={mode} />}

    {view === 'schedule' && <section className="panel schedule-panel">
      <div className="section-heading">
        <div><span className="eyebrow">{mode === 'balanced' ? 'Proposed smart order' : 'Supplied sheet order'}</span><h2>{selectedCourt} order</h2></div>
        <div className="court-tabs">{courtPlans.map((plan) => <button type="button" className={selectedCourt === plan.court ? 'active' : ''} key={plan.court} onClick={() => setSelectedCourt(plan.court)}>{plan.court}</button>)}</div>
      </div>
      <div className="schedule-table" role="table" aria-label={`${selectedCourt} reference order`}>
        <div className="schedule-row header" role="row"><span>Game</span><span>Pool</span><span>Match</span><span>Round</span><span>Source</span></div>
        {selectedMatches.map((match) => <div className="schedule-row" role="row" key={`${match.court}-${match.game}`}>
          <span className="game-badge">{match.game}</span>
          <span className="pool-chip" style={{ borderColor: poolMap.get(match.pool)?.color, color: poolMap.get(match.pool)?.color }}>{match.pool}</span>
          <span className="matchup"><strong>{match.team1}</strong><em>vs</em><strong>{match.team2}</strong></span>
          <span>Round {match.round}</span>
          <span className="queued-state">Reference</span>
        </div>)}
      </div>
    </section>}

    {view === 'fairness' && <section className="panel control-panel">
      <div className="section-heading"><div><span className="eyebrow">Rest check</span><h2>Wait-time monitor</h2></div><Activity size={24} /></div>
      <div className="status-pill good"><span />{mode === 'balanced' ? 'Smart order: spacing optimized' : 'Sheet order as supplied'}</div>
      <div className="fairness-score"><strong>{stats.averageGap}</strong><span>average games a team waits before playing again · longest wait {stats.maxGap}</span></div>
      <div className="risk-list">{stats.worst.map((gap) => <div className="risk-row" key={`${gap.court}-${gap.team}-${gap.from}-${gap.to}`}><div><strong>{gap.team}</strong><span>{gap.court}: Game {gap.from} to {gap.to}</span></div><b>{gap.gap}</b></div>)}</div>
    </section>}
  </>
}
