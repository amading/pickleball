import {
  Activity,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitBranch,
  Gauge,
  ListChecks,
  Settings2,
  Play,
  Radio,
  Search,
  ShieldCheck,
  Shuffle,
  Trophy,
  Users,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import './App.css'
import './redesign.css'
import './bracket.css'
import PoolStage from './PoolStage'
import { OrganizerHub, RegistrationPortal } from './TournamentHub'
import LiveScoring from './LiveScoring'
import LiveDrawBoard from './LiveDrawBoard'

type Pool = {
  id: string
  color: string
  teams: string[]
}

type ScheduledMatch = {
  game: number
  court: string
  pool: string
  team1: string
  team2: string
  round: number
}

type CourtPlan = {
  court: string
  pools: string[]
}

type SectionId = 'dashboard' | 'pools' | 'bracket' | 'schedule' | 'fairness' | 'organizer'

type BracketTeam = {
  seed: number
  name: string
  pool: string
  status: 'qualified' | 'waiting' | 'advanced' | 'eliminated' | 'tbd'
}

type BracketMatch = {
  id: string
  label: string
  status: 'complete' | 'live' | 'next' | 'pending'
  court: string
  time: string
  teams: BracketTeam[]
  winner?: string
  score?: string
}

type BracketRound = {
  title: string
  hint: string
  matches: BracketMatch[]
}

type BracketState = {
  winners: Record<string, string>
  liveId: string | null
}

type LiveCategory = {
  id: string
  title: string
  approvedCount: number
  capacity: number
  winsToQualify: number
  draw: { pools: { name: string; court: string; teams: { id: string; teamName: string; players: { name: string; photo: string }[] }[] }[]; matches: { id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; game?: number; team1: string | null; team2: string | null; score1: number; score2: number; status: 'scheduled' | 'live' | 'final' | 'bye'; winner: string | null }[] } | null
  standings?: { name: string; teams: { id: string; teamName: string; wins: number; losses: number; pointsFor: number; pointsAgainst: number }[] }[]
  qualified?: { id: string; teamName: string; wins: number; pool: string }[]
  playoff?: { rounds: { name: string; matches: { id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; game?: number; team1: string | null; team2: string | null; score1: number; score2: number; status: 'scheduled' | 'live' | 'final' | 'bye'; winner: string | null }[] }[] } | null
}

const sections: { id: SectionId; label: string; icon: typeof Gauge }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'pools', label: 'Pools', icon: Users },
  { id: 'bracket', label: 'Bracket', icon: GitBranch },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'fairness', label: 'Fairness', icon: Activity },
  { id: 'organizer', label: 'Organizer', icon: Settings2 },
]

const pools: Pool[] = [
  {
    id: 'Pool A',
    color: '#1471a8',
    teams: ['gulas team', 'PCP: Raymond-Wen', 'CNLPWS SMASH 2.0', 'Rojan-Gerald', 'Kepe-Bryan'],
  },
  {
    id: 'Pool B',
    color: '#2f8b58',
    teams: ['Perse Picklers', 'iamMIKA Inc. Pickleball', 'Tribu-Rat', 'Lhey-Ann & John', 'Gichelle-Jessa'],
  },
  {
    id: 'Pool C',
    color: '#f0bd2f',
    teams: ['team duday', 'Dimple-Amads', 'Gwenn-Jhasmine', 'Dorence-Emman', 'iamMIKA Inc. Pickleball (C)'],
  },
  {
    id: 'Pool D',
    color: '#f37b19',
    teams: ['OFF COURT', 'PBPC - Klent x Vince', 'Team hapak', 'Rema-Igi', 'IamMika Inc. Pickleball Team'],
  },
  {
    id: 'Pool E',
    color: '#9b2fc1',
    teams: ['Perse Picklers (E)', 'HAPAKRA', 'PCP - Nino & Erica', 'dilldou', 'Banny-Gerald'],
  },
  {
    id: 'Pool F',
    color: '#1676a6',
    teams: ['Hoi walang kanin bossing', 'PCP_Bryand&Janinne', 'Kaye-Jelou', 'Jake-Meghan', 'Pipo-Lemon'],
  },
  {
    id: 'Pool G',
    color: '#2f8751',
    teams: ['Crown Regal', 'Antonite', 'PCP:Potpot-Macmon', 'Kert-VJ', 'Entice-Melkiens'],
  },
  {
    id: 'Pool H',
    color: '#793ccc',
    teams: ['Zeanly Majnutganon Y.', 'JUC PC BRIX AND NYGEL', 'iamMika Inc. Pickleball (H)', 'Oweng-Atchiel', 'SJDB PICKLEBALL CLUB'],
  },
  {
    id: 'Pool I',
    color: '#168f8a',
    teams: ['Yohoo!', 'PCP_Anton&Jay Ann', 'San Jose De Buan Pickleball', 'Jorenz-Angelo', 'Josh-Alex'],
  },
]

const courtPlans: CourtPlan[] = [
  { court: 'Court 1', pools: ['Pool A', 'Pool B', 'Pool C'] },
  { court: 'Court 2', pools: ['Pool D', 'Pool E', 'Pool F'] },
  { court: 'Court 3', pools: ['Pool G', 'Pool H', 'Pool I'] },
]

const bracketRounds: BracketRound[] = [
  {
    title: 'Quarterfinals',
    hint: 'Top pool teams enter here',
    matches: [
      {
        id: 'QF1',
        label: 'QF 1',
        status: 'complete',
        court: 'Court 1',
        time: '10:40 AM',
        score: '11-7',
        winner: 'gulas team',
        teams: [
          { seed: 1, name: 'gulas team', pool: 'Pool A', status: 'advanced' },
          { seed: 8, name: 'Dimple-Amads', pool: 'Pool C', status: 'eliminated' },
        ],
      },
      {
        id: 'QF2',
        label: 'QF 2',
        status: 'live',
        court: 'Court 2',
        time: 'Live now',
        teams: [
          { seed: 4, name: 'Perse Picklers', pool: 'Pool B', status: 'qualified' },
          { seed: 5, name: 'HAPAKRA', pool: 'Pool E', status: 'qualified' },
        ],
      },
      {
        id: 'QF3',
        label: 'QF 3',
        status: 'next',
        court: 'Court 3',
        time: 'Next available',
        teams: [
          { seed: 3, name: 'Crown Regal', pool: 'Pool G', status: 'waiting' },
          { seed: 6, name: 'team duday', pool: 'Pool C', status: 'waiting' },
        ],
      },
      {
        id: 'QF4',
        label: 'QF 4',
        status: 'pending',
        court: 'Court 1',
        time: 'After QF 1',
        teams: [
          { seed: 2, name: 'Yohoo!', pool: 'Pool I', status: 'waiting' },
          { seed: 7, name: 'OFF COURT', pool: 'Pool D', status: 'waiting' },
        ],
      },
    ],
  },
  {
    title: 'Semifinals',
    hint: 'Winners move here',
    matches: [
      {
        id: 'SF1',
        label: 'SF 1',
        status: 'next',
        court: 'Court 2',
        time: 'After QF 2',
        teams: [
          { seed: 1, name: 'gulas team', pool: 'Winner QF 1', status: 'advanced' },
          { seed: 0, name: 'Winner QF 2', pool: 'TBD', status: 'tbd' },
        ],
      },
      {
        id: 'SF2',
        label: 'SF 2',
        status: 'pending',
        court: 'Court 3',
        time: 'After QF 4',
        teams: [
          { seed: 0, name: 'Winner QF 3', pool: 'TBD', status: 'tbd' },
          { seed: 0, name: 'Winner QF 4', pool: 'TBD', status: 'tbd' },
        ],
      },
    ],
  },
  {
    title: 'Finals',
    hint: 'Championship match',
    matches: [
      {
        id: 'F1',
        label: 'Final',
        status: 'pending',
        court: 'Center Court',
        time: 'To be called',
        teams: [
          { seed: 0, name: 'Winner SF 1', pool: 'TBD', status: 'tbd' },
          { seed: 0, name: 'Winner SF 2', pool: 'TBD', status: 'tbd' },
        ],
      },
    ],
  },
]

const bracketStorageKey = 'rally-hq-bracket-v1'
const bracketOrder = ['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'F1']
const nextRoundSources: Record<string, string[]> = {
  SF1: ['QF1', 'QF2'],
  SF2: ['QF3', 'QF4'],
  F1: ['SF1', 'SF2'],
}
const descendants: Record<string, string[]> = {
  QF1: ['SF1', 'F1'], QF2: ['SF1', 'F1'],
  QF3: ['SF2', 'F1'], QF4: ['SF2', 'F1'],
  SF1: ['F1'], SF2: ['F1'], F1: [],
}
const bracketPaths = [
  { from: 'QF1', d: 'M344 185 H366 Q376 185 376 195 V270 Q376 280 386 280 H408' },
  { from: 'QF2', d: 'M344 375 H366 Q376 375 376 365 V290 Q376 280 386 280 H408' },
  { from: 'QF3', d: 'M344 565 H366 Q376 565 376 575 V650 Q376 660 386 660 H408' },
  { from: 'QF4', d: 'M344 755 H366 Q376 755 376 745 V670 Q376 660 386 660 H408' },
  { from: 'SF1', d: 'M728 280 H750 Q760 280 760 290 V460 Q760 470 770 470 H792' },
  { from: 'SF2', d: 'M728 660 H750 Q760 660 760 650 V480 Q760 470 770 470 H792' },
]

function getReadyMatchIds(winners: Record<string, string>) {
  return bracketOrder.filter((id) => !winners[id] && (!nextRoundSources[id] || nextRoundSources[id].every((source) => winners[source])))
}

function normalizeWinners(candidates: Record<string, string>) {
  const winners: Record<string, string> = {}
  for (const id of bracketOrder) {
    const sources = nextRoundSources[id]
    const names = sources
      ? sources.map((source) => winners[source]).filter(Boolean)
      : bracketRounds[0].matches.find((match) => match.id === id)?.teams.map((team) => team.name) ?? []
    if (names.length === 2 && names.includes(candidates[id])) winners[id] = candidates[id]
  }
  return winners
}

function readBracketState(): BracketState {
  const fallback: BracketState = { winners: { QF1: 'gulas team' }, liveId: 'QF2' }
  try {
    const saved = window.localStorage.getItem(bracketStorageKey)
    if (!saved) return fallback
    const parsed = JSON.parse(saved) as BracketState
    if (!parsed || typeof parsed.winners !== 'object' || !parsed.winners) return fallback
    const winners = normalizeWinners(Object.fromEntries(Object.entries(parsed.winners).filter(([id, name]) => bracketOrder.includes(id) && typeof name === 'string')))
    const ready = getReadyMatchIds(winners)
    return { winners, liveId: typeof parsed.liveId === 'string' && ready.includes(parsed.liveId) ? parsed.liveId : (ready[0] ?? null) }
  } catch {
    return fallback
  }
}

function buildBracket(state: BracketState) {
  const rounds: BracketRound[] = bracketRounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => ({ ...match, teams: match.teams.map((team) => ({ ...team })) })),
  }))
  const byId = new Map(rounds.flatMap((round) => round.matches).map((match) => [match.id, match]))

  for (const [destination, sources] of Object.entries(nextRoundSources)) {
    const match = byId.get(destination)!
    match.teams = sources.map((source, index) => {
      const priorMatch = byId.get(source)!
      const winner = priorMatch.teams.find((team) => team.name === state.winners[source])
      return winner
        ? { ...winner, pool: `Winner ${priorMatch.label}`, status: 'waiting' }
        : { ...match.teams[index], name: `Winner ${priorMatch.label}`, pool: 'Awaiting result', status: 'tbd' }
    })
  }

  const ready = getReadyMatchIds(state.winners)
  const liveId = state.liveId && ready.includes(state.liveId) ? state.liveId : null
  const nextId = ready.find((id) => id !== liveId)

  for (const match of byId.values()) {
    const winner = match.teams.some((team) => team.name === state.winners[match.id]) ? state.winners[match.id] : undefined
    match.winner = winner
    match.status = winner ? 'complete' : match.id === liveId ? 'live' : match.id === nextId ? 'next' : 'pending'
    match.score = undefined
    match.teams = match.teams.map((team) => ({
      ...team,
      status: team.status === 'tbd' ? 'tbd' : winner ? (team.name === winner ? 'advanced' : 'eliminated') : 'waiting',
    }))
  }

  return { rounds, byId, liveId, nextId, ready }
}

const poolMap = new Map(pools.map((pool) => [pool.id, pool]))

function buildBalancedSchedule() {
  const schedule: ScheduledMatch[] = []

  for (const plan of courtPlans) {
    const remaining = plan.pools.flatMap((poolId) => {
      const pool = poolMap.get(poolId)
      if (!pool) throw new Error(`Missing pool ${poolId}`)

      const matches: Omit<ScheduledMatch, 'game' | 'court' | 'round'>[] = []
      for (let i = 0; i < pool.teams.length; i += 1) {
        for (let j = i + 1; j < pool.teams.length; j += 1) {
          matches.push({
            pool: pool.id,
            team1: pool.teams[i],
            team2: pool.teams[j],
          })
        }
      }

      return matches
    })

    const lastPlayed = new Map<string, number>()
    const playCount = new Map<string, number>()
    let courtGame = 1

    while (remaining.length > 0) {
      let bestIndex = 0
      let bestScore = Number.NEGATIVE_INFINITY

      for (let index = 0; index < remaining.length; index += 1) {
        const match = remaining[index]
        const team1Last = lastPlayed.get(match.team1) ?? -99
        const team2Last = lastPlayed.get(match.team2) ?? -99
        const team1Rest = courtGame - team1Last
        const team2Rest = courtGame - team2Last
        const leastRestedTeam = Math.min(team1Rest, team2Rest)
        const totalAppearances = (playCount.get(match.team1) ?? 0) + (playCount.get(match.team2) ?? 0)
        const samePoolAsPrevious = schedule.at(-1)?.court === plan.court && schedule.at(-1)?.pool === match.pool
        const recentPenalty = (team1Rest <= 2 ? 100 : 0) + (team2Rest <= 2 ? 100 : 0)
        const poolPenalty = samePoolAsPrevious ? 8 : 0
        const tieBreaker = -index / 1000
        const score = leastRestedTeam * 5 - totalAppearances * 2 - recentPenalty - poolPenalty + tieBreaker

        if (score > bestScore) {
          bestScore = score
          bestIndex = index
        }
      }

      const [match] = remaining.splice(bestIndex, 1)
      schedule.push({
        ...match,
        game: courtGame,
        court: plan.court,
        round: Math.ceil(courtGame / (plan.pools.length * 2)),
      })

      lastPlayed.set(match.team1, courtGame)
      lastPlayed.set(match.team2, courtGame)
      playCount.set(match.team1, (playCount.get(match.team1) ?? 0) + 1)
      playCount.set(match.team2, (playCount.get(match.team2) ?? 0) + 1)
      courtGame += 1
    }
  }

  return schedule
}

function buildManualStyleSchedule() {
  const schedule: ScheduledMatch[] = []

  for (const plan of courtPlans) {
    const matchesByPool = plan.pools.map((poolId) => {
      const pool = poolMap.get(poolId)
      if (!pool) throw new Error(`Missing pool ${poolId}`)

      const matches: { team1: string; team2: string }[] = []
      for (let i = 0; i < pool.teams.length; i += 1) {
        for (let j = i + 1; j < pool.teams.length; j += 1) {
          matches.push({ team1: pool.teams[i], team2: pool.teams[j] })
        }
      }

      return { pool, matches }
    })

    const maxMatches = Math.max(...matchesByPool.map(({ matches }) => matches.length))
    let courtGame = 1

    for (let matchIndex = 0; matchIndex < maxMatches; matchIndex += 1) {
      for (const { pool, matches } of matchesByPool) {
        const match = matches[matchIndex]
        if (!match) continue

        schedule.push({
          game: courtGame,
          court: plan.court,
          pool: pool.id,
          team1: match.team1,
          team2: match.team2,
          round: Math.floor(matchIndex / 2) + 1,
        })
        courtGame += 1
      }
    }
  }

  return schedule
}

function getWaitStats(schedule: ScheduledMatch[]) {
  const appearances = new Map<string, number[]>()

  for (const match of schedule) {
    const courtKey = match.court

    for (const team of [match.team1, match.team2]) {
      const key = `${courtKey}::${team}`
      appearances.set(key, [...(appearances.get(key) ?? []), match.game])
    }
  }

  const gaps = [...appearances.entries()].flatMap(([key, games]) => {
    return games.slice(1).map((game, index) => ({
      team: key.split('::')[1],
      court: key.split('::')[0],
      from: games[index],
      to: game,
      gap: game - games[index] - 1,
    }))
  })

  const maxGap = Math.max(...gaps.map((gap) => gap.gap))
  const averageGap = gaps.reduce((sum, gap) => sum + gap.gap, 0) / gaps.length
  const worst = [...gaps].sort((a, b) => b.gap - a.gap).slice(0, 5)

  return {
    averageGap: Number(averageGap.toFixed(1)),
    maxGap,
    worst,
  }
}

function getPoolColor(poolId: string) {
  return poolMap.get(poolId)?.color ?? '#3b82f6'
}

function App() {
  const [mode, setMode] = useState<'balanced' | 'manual'>('balanced')
  const [selectedCourt, setSelectedCourt] = useState('Court 1')
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard')
  const [bracketView, setBracketView] = useState<'live' | 'pools' | 'playoff'>('live')
  const [liveCategories, setLiveCategories] = useState<LiveCategory[]>([])
  const [selectedLiveCategoryId, setSelectedLiveCategoryId] = useState('')
  const [teamQuery, setTeamQuery] = useState('')
  const [bracketState, setBracketState] = useState<BracketState>(readBracketState)
  const bracket = useMemo(() => buildBracket(bracketState), [bracketState])
  const allBracketMatches = bracket.rounds.flatMap((round) => round.matches)
  const liveMatch = bracket.liveId ? bracket.byId.get(bracket.liveId) : undefined
  const nextMatch = bracket.nextId ? bracket.byId.get(bracket.nextId) : undefined
  const selectedLiveCategory = liveCategories.find((category) => category.id === selectedLiveCategoryId) ?? liveCategories[0]

  useLayoutEffect(() => {
    window.localStorage.setItem(bracketStorageKey, JSON.stringify(bracketState))
  }, [bracketState])

  useEffect(() => {
    const syncBracket = (event: StorageEvent) => {
      if (event.key === bracketStorageKey && event.newValue) setBracketState(readBracketState())
    }
    window.addEventListener('storage', syncBracket)
    return () => window.removeEventListener('storage', syncBracket)
  }, [])

  useEffect(() => {
    let active = true
    async function loadLiveCategories() {
      try {
        const response = await fetch('/api/categories', { cache: 'no-store' })
        const items = await response.json()
        if (!response.ok) throw new Error(items.error || 'Could not load categories.')
        if (!active) return
        setLiveCategories(items)
        setSelectedLiveCategoryId((current) => items.some((item: LiveCategory) => item.id === current) ? current : (items.find((item: LiveCategory) => item.draw)?.id || items[0]?.id || ''))
      } catch {
        if (active) setLiveCategories([])
      }
    }
    void loadLiveCategories()
    const timer = window.setInterval(() => { void loadLiveCategories() }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const schedule = useMemo(
    () => (mode === 'balanced' ? buildBalancedSchedule() : buildManualStyleSchedule()),
    [mode],
  )
  const selectedMatches = schedule.filter((match) => match.court === selectedCourt)
  const stats = getWaitStats(schedule)
  const totalTeams = pools.reduce((sum, pool) => sum + pool.teams.length, 0)
  const activeLabel = sections.find((section) => section.id === activeSection)?.label ?? 'Dashboard'
  const seedTeams = bracketRounds[0].matches.flatMap((match) => match.teams.map((team) => team.name))
  const matchingTeams = seedTeams.filter((name) => name.toLowerCase().includes(teamQuery.toLowerCase()))
  const selectedTeamName = seedTeams.find((name) => name.toLowerCase() === teamQuery.trim().toLowerCase())
  const appearances = selectedTeamName
    ? allBracketMatches.filter((match) => match.teams.some((team) => team.name === selectedTeamName))
    : []
  const trackedMatch = appearances.findLast((match) => !match.winner) ?? appearances.at(-1)
  const trackedOpponent = trackedMatch?.teams.find((team) => team.name !== selectedTeamName)
  const trackedStatus = trackedMatch?.winner
    ? trackedMatch.winner === selectedTeamName ? 'Champion' : 'Eliminated'
    : trackedMatch?.status === 'live' ? 'In game now'
      : trackedMatch?.status === 'next' ? 'Next game'
        : 'Waiting for next game'

  function pickWinner(matchId: string, teamName: string) {
    const match = bracket.byId.get(matchId)
    if (!match || match.teams.some((team) => team.status === 'tbd') || !match.teams.some((team) => team.name === teamName)) return

    setBracketState((current) => {
      if (current.winners[matchId] === teamName) return current
      const winners = { ...current.winners, [matchId]: teamName }
      for (const id of descendants[matchId]) delete winners[id]
      const ready = getReadyMatchIds(winners)
      const liveId = current.liveId === matchId || !current.liveId || !ready.includes(current.liveId)
        ? (ready[0] ?? null)
        : current.liveId
      return { winners, liveId }
    })
  }

  function startMatch(matchId: string) {
    setBracketState((current) => getReadyMatchIds(current.winners).includes(matchId)
      ? { ...current, liveId: matchId }
      : current)
  }

  const scorePage = new URLSearchParams(window.location.search).get('score')
  if (scorePage) return <LiveScoring scoreKey={scorePage} />
  const registrationPage = new URLSearchParams(window.location.search).get('register')
  if (registrationPage) return <RegistrationPortal categoryId={registrationPage} />

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <span className="brand-icon"><Trophy size={24} /></span>
          <div>
            <strong>RALLY<span> / </span>HQ</strong>
            <small>PICKLEBALL OPERATIONS</small>
          </div>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="nav-list" aria-label="Primary">
          {sections.map((section) => {
            const Icon = section.icon

            return (
              <button
                className={activeSection === section.id ? 'active' : ''}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon size={18} />
                {section.label}
              </button>
            )
          })}
        </nav>

        <a className="registration-nav-link" href="?register=all">Player registration <ArrowRight size={15} /></a>

        <div className="sidebar-card">
          <span className="sidebar-card-icon"><CircleDot size={18} /></span>
          <span className="eyebrow">REFERENCE SHEET</span>
          <strong>Regall Showdown</strong>
          <p>Example newbie genderless lineup</p>
          <span className="sidebar-card-foot">9 POOLS <span>•</span> 3 COURTS</span>
        </div>
        <div className="sidebar-bottom">BUILT FOR THE NEXT GAME <span>↗</span></div>
      </aside>

      <section className="workspace">
        <div className="section-switcher">
          <div>
            <span className="breadcrumb">REGALL SHOWDOWN <span>/</span> {activeLabel.toUpperCase()}</span>
            <strong>{activeLabel}</strong>
          </div>
          {activeSection !== 'organizer' && <div className="hero-actions" aria-label="Schedule mode">
            <button className={mode === 'balanced' ? 'primary-btn' : 'ghost-btn'} onClick={() => setMode('balanced')}>
              <ShieldCheck size={18} />
              Smart schedule
            </button>
            <button className={mode === 'manual' ? 'primary-btn warning' : 'ghost-btn'} onClick={() => setMode('manual')}>
              <Shuffle size={18} />
              Sheet order
            </button>
          </div>}
        </div>

        {activeSection === 'organizer' && <OrganizerHub />}

        {activeSection === 'dashboard' && (
          <>
            <header className="hero-panel">
              <div className="hero-copy">
                <span className="hero-kicker"><span /> THE COURT IS CALLING</span>
                <h1>Every game.<br /><em>One clear path.</em></h1>
                <p>Explore the supplied Regall pool example, then open Organizer to create your own live categories and player draw.</p>
                <div className="hero-links">
                  <button className="hero-cta" onClick={() => setActiveSection('bracket')}>Explore bracket <ArrowRight size={18} /></button>
                  <button className="hero-secondary" onClick={() => setActiveSection('schedule')}>View schedule <ArrowRight size={17} /></button>
                </div>
              </div>
              <div className="hero-art" aria-hidden="true"><div className="court-graphic"><span className="court-net" /><span className="court-ball" /></div><span className="hero-art-caption">PLAY THE MOMENT / OWN THE MATCH</span></div>
            </header>

            <div className="dashboard-heading"><div><span className="eyebrow">TOURNAMENT PULSE</span><h2>The event at a glance</h2></div><span className="demo-indicator">Preview data</span></div>

            <section className="metric-grid" aria-label="Tournament summary">
              <article className="metric-card">
                <span className="metric-icon"><Users size={21} /></span>
                <span>{totalTeams}</span>
                <p>Teams</p>
              </article>
              <article className="metric-card">
                <span className="metric-icon"><CircleDot size={21} /></span>
                <span>{pools.length}</span>
                <p>Pools</p>
              </article>
              <article className="metric-card">
                <span className="metric-icon"><CalendarClock size={21} /></span>
                <span>{schedule.length}</span>
                <p>Total games</p>
              </article>
              <article className="metric-card">
                <span className="metric-icon"><Clock3 size={21} /></span>
                <span>{stats.maxGap}</span>
                <p>Worst idle slots</p>
              </article>
            </section>
            <div className="dashboard-bottom">
              <button className="feature-card bracket-feature" onClick={() => setActiveSection('bracket')}><span className="feature-icon"><GitBranch size={22} /></span><span><small>PLAYER VIEW</small><strong>Find your pool games</strong><em>See all opponents, your next game and live pool standings.</em></span><ArrowRight size={22} /></button>
              <button className="feature-card schedule-feature" onClick={() => setActiveSection('schedule')}><span className="feature-icon"><CalendarClock size={22} /></span><span><small>ORGANIZER VIEW</small><strong>Keep the games moving</strong><em>A balanced game order for all three courts.</em></span><ArrowRight size={22} /></button>
            </div>
          </>
        )}

        {activeSection === 'pools' && (
          <section className="panel lineup-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Official pool line-up</span>
                <h2>Newbie genderless category</h2>
              </div>
              <CheckCircle2 size={24} />
            </div>

            <div className="pool-grid">
              {pools.map((pool) => (
                <article className="pool-card" key={pool.id}>
                  <h3 style={{ background: pool.color }}>{pool.id}</h3>
                  <ol>
                    {pool.teams.map((team) => (
                      <li key={team}>{team}</li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeSection === 'fairness' && (
          <section className="panel control-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Fairness check</span>
                <h2>Wait-time monitor</h2>
              </div>
              <Activity size={24} />
            </div>

            <div className="status-pill good">
              <span />
              {mode === 'balanced' ? 'Organizer-grade spacing active' : 'Manual sample mode'}
            </div>

            <div className="fairness-score">
              <strong>{stats.averageGap}</strong>
              <span>average idle games before a team plays again</span>
            </div>

            <div className="risk-list">
              {stats.worst.map((gap) => (
                <div className="risk-row" key={`${gap.court}-${gap.team}-${gap.from}-${gap.to}`}>
                  <div>
                    <strong>{gap.team}</strong>
                    <span>{gap.court}: Game {gap.from} to {gap.to}</span>
                  </div>
                  <b>{gap.gap}</b>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeSection === 'bracket' && (
          <>
          <div className="bracket-view-switcher" aria-label="Tournament stage">
            <div><span className="eyebrow">TOURNAMENT FLOW</span><strong>Live categories first. Sample sheet stays separate.</strong></div>
            <div className="bracket-view-tabs">
              <button className={bracketView === 'live' ? 'active' : ''} onClick={() => setBracketView('live')}>Live categories <span>{liveCategories.length || 'none'}</span></button>
              <button className={bracketView === 'pools' ? 'active' : ''} onClick={() => setBracketView('pools')}>Regall sample <span>90 games</span></button>
              <button className={bracketView === 'playoff' ? 'active' : ''} onClick={() => setBracketView('playoff')}>Playoff layout <span>sample</span></button>
            </div>
          </div>
          {bracketView === 'live' ? (
          <section className="panel live-category-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">ACTUAL ORGANIZER CATEGORIES</span>
                <h2>Live bracket board<span className="heading-accent">.</span></h2>
              </div>
              <span className="demo-indicator live">Real results</span>
            </div>
            {liveCategories.length ? (
              <>
                <div className="live-category-tabs">
                  {liveCategories.map((category) => <button type="button" className={category.id === selectedLiveCategory?.id ? 'active' : ''} key={category.id} onClick={() => setSelectedLiveCategoryId(category.id)}><strong>{category.title}</strong><span>{category.draw ? `${category.draw.pools.length} pools` : 'registration open'} · {category.approvedCount}/{category.capacity} approved</span></button>)}
                </div>
                {selectedLiveCategory?.draw ? <LiveDrawBoard category={selectedLiveCategory} /> : (
                  <div className="live-category-empty">
                    <strong>{selectedLiveCategory?.title}</strong>
                    <p>This category is live for registration. It appears as a full bracket board after the organizer publishes the random draw.</p>
                    <a href={`?register=${selectedLiveCategory?.id}`}>Open player registration <ArrowRight size={16} /></a>
                  </div>
                )}
              </>
            ) : (
              <div className="live-category-empty">
                <strong>No live categories yet.</strong>
                <p>Create a category in Organizer, approve players, then publish the draw. It will show here automatically.</p>
                <button type="button" onClick={() => setActiveSection('organizer')}>Open Organizer <ArrowRight size={16} /></button>
              </div>
            )}
          </section>
          ) : bracketView === 'pools' ? <PoolStage pools={pools} schedule={schedule} scheduleMode={mode} /> : (
          <section className="panel bracket-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">LAYOUT EXAMPLE ONLY</span>
                <h2>Sample playoff bracket<span className="heading-accent">.</span></h2>
              </div>
              <span className="demo-indicator">Not actual results</span>
            </div>

            <div className="playoff-demo-note">The screenshots show pool games only. This knockout draw uses example teams and results; qualifier count and tiebreak rules still need to be set by the organizer.</div>

            <div className="player-update-board">
              <div className="player-update-head">
                <div>
                  <span className="eyebrow">SAMPLE PLAYOFF TRACKER</span>
                  <h3>See how advancement works.</h3>
                  <p>Try clicking a winner here. Actual pool results are in the Pool stage tab.</p>
                </div>
                <div className="team-search">
                  <Search size={18} />
                  <input aria-label="Find a team" list="bracket-teams" placeholder="Find your team..." value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} />
                  <datalist id="bracket-teams">{matchingTeams.map((name) => <option value={name} key={name} />)}</datalist>
                </div>
              </div>
              {teamQuery.trim() && !selectedTeamName && <p className="team-search-hint">Choose a complete team name from the suggestions to see its next game.</p>}
              <div className="player-update-grid" aria-live="polite">
                {selectedTeamName && trackedMatch ? (
                  <article className={`update-tile personal ${trackedMatch.status}`}>
                    <div className="update-tile-label"><CircleDot size={16} /> {trackedStatus}</div>
                    <strong>{selectedTeamName}</strong>
                    <p>{trackedMatch.label} · {trackedMatch.court} · {trackedMatch.winner ? 'Result posted' : trackedMatch.time}</p>
                    <span>{trackedMatch.winner && trackedMatch.winner !== selectedTeamName ? 'Your playoff run has ended.' : trackedOpponent?.status === 'tbd' ? 'Opponent to be confirmed' : `vs ${trackedOpponent?.name ?? 'TBD'}`}</span>
                  </article>
                ) : (
                  <>
                    <article className="update-tile current">
                      <div className="update-tile-label"><Radio size={16} /> IN GAME</div>
                      <strong>{liveMatch ? liveMatch.teams.map((team) => team.name).join(' vs ') : 'No game in progress'}</strong>
                      <p>{liveMatch ? `${liveMatch.label} · ${liveMatch.court}` : 'Start a ready match from the bracket.'}</p>
                    </article>
                    <article className="update-tile upcoming">
                      <div className="update-tile-label"><CalendarClock size={16} /> NEXT UP</div>
                      <strong>{nextMatch ? nextMatch.teams.map((team) => team.name).join(' vs ') : 'Awaiting next result'}</strong>
                      <p>{nextMatch ? `${nextMatch.label} · ${nextMatch.court}` : 'The next match appears here automatically.'}</p>
                    </article>
                  </>
                )}
              </div>
              <div className="organizer-instruction">
                <span>ORGANIZER</span> Click the winning team in a match to advance it. Use Start game to light up the active court.
                <button onClick={() => { setBracketState({ winners: { QF1: 'gulas team' }, liveId: 'QF2' }); setTeamQuery('') }}>Reset preview</button>
              </div>
            </div>

            <div className="bracket-legend"><span><i className="legend-dot complete" /> Complete</span><span><i className="legend-dot live" /> Live</span><span><i className="legend-dot next" /> Next</span><span><i className="legend-dot pending" /> Pending</span></div>

            <div className="bracket-scroll-tip">Swipe to follow the road to the final <span>→</span></div>

            <div className="bracket-stage" aria-label="Playoff bracket">
              <svg className="bracket-connections" viewBox="0 0 1148 870" aria-hidden="true">
                <defs>
                  <linearGradient id="bracketPath" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#b8ea69" />
                    <stop offset="1" stopColor="#78c8b2" />
                  </linearGradient>
                </defs>
                {bracketPaths.map((path) => {
                  const source = bracket.byId.get(path.from)
                  return <path key={path.from} className={source?.winner ? 'path-active' : source?.status === 'live' ? 'path-live' : ''} d={path.d} />
                })}
                <circle cx="376" cy="280" r="4" />
                <circle cx="376" cy="660" r="4" />
                <circle cx="760" cy="470" r="4" />
              </svg>
              {bracket.rounds.map((round, roundIndex) => (
                <section className="bracket-round" key={round.title}>
                  <div className="round-heading">
                    <b>0{roundIndex + 1} <span>/ 03</span></b>
                    <span>{round.hint}</span>
                    <h3>{round.title}</h3>
                  </div>

                  <div className="round-matches">
                    {round.matches.map((match) => (
                      <article className={`bracket-match ${match.status} ${teamQuery.trim() && match.teams.some((team) => team.name.toLowerCase() === teamQuery.toLowerCase()) ? 'tracked' : ''}`} key={match.id}>
                        <div className="match-topline">
                          <span>{match.label}</span>
                          {match.status === 'complete' && <b>FINAL</b>}
                          {match.status === 'live' && <b className="in-game-badge"><span /> IN GAME</b>}
                          {match.status !== 'complete' && match.status !== 'live' && bracket.ready.includes(match.id) && (
                            <button className="start-match" onClick={() => startMatch(match.id)} aria-label={`Start ${match.label}`}><Play size={11} fill="currentColor" /> Start game</button>
                          )}
                          {match.status === 'pending' && !bracket.ready.includes(match.id) && <b>WAITING</b>}
                        </div>

                        <div className="bracket-teams">
                          {match.teams.map((team) => (
                            <button
                              type="button"
                              className={`bracket-team ${team.status} ${match.winner === team.name ? 'winner' : ''}`}
                              key={`${match.id}-${team.name}`}
                              disabled={match.teams.some((entry) => entry.status === 'tbd') || team.status === 'tbd'}
                              onClick={() => pickWinner(match.id, team.name)}
                              aria-label={`Advance ${team.name} as winner of ${match.label}`}
                              aria-pressed={match.winner === team.name}
                            >
                              <span className="seed">{team.seed || '-'}</span>
                              <div>
                                <strong>{team.name}</strong>
                                <small>{team.pool}</small>
                              </div>
                              {match.winner === team.name && <span className="winner-chip">{match.id === 'F1' ? 'CHAMP' : 'ADV'}</span>}
                            </button>
                          ))}
                        </div>

                        <div className="match-meta">
                          <span>{match.court}</span>
                          <span>{match.status === 'live' ? 'Playing now' : match.status === 'complete' ? 'Winner advanced' : match.time}</span>
                        </div>

                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
          )}
          </>
        )}

        {activeSection === 'schedule' && (
          <section className="panel schedule-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Court control center</span>
                <h2>{selectedCourt} schedule</h2>
              </div>
              <div className="court-tabs">
                {courtPlans.map((plan) => (
                  <button
                    className={selectedCourt === plan.court ? 'active' : ''}
                    key={plan.court}
                    onClick={() => setSelectedCourt(plan.court)}
                  >
                    {plan.court}
                  </button>
                ))}
              </div>
            </div>

            <div className="schedule-table" role="table" aria-label={`${selectedCourt} match schedule`}>
              <div className="schedule-row header" role="row">
                <span>Game</span>
                <span>Pool</span>
                <span>Match</span>
                <span>Round</span>
                <span>Status</span>
              </div>

              {selectedMatches.map((match, index) => (
                <div className="schedule-row" role="row" key={`${match.court}-${match.game}`}>
                  <span className="game-badge">{match.game}</span>
                  <span className="pool-chip" style={{ borderColor: getPoolColor(match.pool), color: getPoolColor(match.pool) }}>
                    {match.pool}
                  </span>
                  <span className="matchup">
                    <strong>{match.team1}</strong>
                    <em>vs</em>
                    <strong>{match.team2}</strong>
                  </span>
                  <span>Round {match.round}</span>
                  <span className={index < 2 ? 'live-state' : 'queued-state'}>
                    {index < 2 ? <Play size={14} /> : <ListChecks size={14} />}
                    {index < 2 ? 'Ready' : 'Queued'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  )
}

export default App
