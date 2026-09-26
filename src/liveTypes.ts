// Shapes returned by the public /api/categories endpoint (no registrations, no score tokens).
export type LivePlayer = { name: string; photo: string }
export type LiveTeam = { id: string; teamName: string; players: LivePlayer[] }
export type MatchStatus = 'scheduled' | 'live' | 'final' | 'bye'
export type LiveMatch = {
  id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; game?: number
  team1: string | null; team2: string | null; score1: number; score2: number; status: MatchStatus; winner: string | null
}
export type LiveStanding = { name: string; teams: { id: string; teamName: string; wins: number; losses: number; pointsFor: number; pointsAgainst: number }[] }
export type LiveCategory = {
  id: string; title: string; division: string; format: 'doubles' | 'mixed-doubles' | 'singles'
  approvedCount: number; capacity: number; winsToQualify: number; pointsToWin: number; winBy: number
  draw: { pools: { name: string; court: string; teams: LiveTeam[] }[]; matches: LiveMatch[]; publishedAt: string } | null
  standings?: LiveStanding[]
  qualified?: { id: string; teamName: string; wins: number; pool: string }[]
  playoff?: { publishedAt: string; rounds: { name: string; matches: LiveMatch[] }[] } | null
}

export function teamsById(category: LiveCategory) {
  return new Map((category.draw?.pools ?? []).flatMap((pool) => pool.teams.map((team) => [team.id, team] as const)))
}

/** Pool games in published order, then playoff games round by round, each tagged with a readable label. */
export function orderedMatches(category: LiveCategory) {
  const pool = (category.draw?.matches ?? []).map((match) => ({ match, label: match.pool ?? 'Pool' }))
  const playoff = (category.playoff?.rounds ?? []).flatMap((round) => round.matches.map((match) => ({ match, label: round.name })))
  return [...pool, ...playoff]
}

/** A match is playable once both opponents are known and it is not already decided. */
export function playable(match: LiveMatch) {
  return match.status !== 'final' && match.status !== 'bye' && Boolean(match.team1 && match.team2)
}
