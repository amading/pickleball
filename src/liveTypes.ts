// Shapes returned by the public /api/categories endpoint (no registrations, no score tokens).
export type LivePlayer = { name: string; photo: string }
export type LiveTeam = { id: string; teamName: string; players: LivePlayer[] }
export type MatchStatus = 'scheduled' | 'live' | 'final' | 'bye'
export type LiveMatch = {
  id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; game?: number
  team1: string | null; team2: string | null; score1: number; score2: number; status: MatchStatus; winner: string | null
}
export type LiveStanding = { name: string; teams: { id: string; teamName: string; wins: number; losses: number; pointsFor: number; pointsAgainst: number; rank?: number }[] }
export type LiveCategory = {
  id: string; title: string; division: string; format: 'doubles' | 'mixed-doubles' | 'singles'
  approvedCount: number; capacity: number; winsToQualify: number; pointsToWin: number; winBy: number
  qualifyMode: 'top' | 'wins'; qualifyTop: number
  locked?: boolean; drawPublished?: boolean; privateBoard?: boolean; ended?: boolean
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

/** Plain-language playoff rule, e.g. "Top 2 per pool" or "3+ wins". */
export function qualifyRule(category: { qualifyMode?: 'top' | 'wins'; qualifyTop?: number; winsToQualify: number }) {
  return category.qualifyMode === 'top' ? `Top ${category.qualifyTop ?? 2} per pool` : `${category.winsToQualify}+ wins`
}

/** A player's photo, or a generated initials badge when the photo is missing. */
export function avatarSrc(name: string, photo?: string) {
  if (photo) return photo
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1e3f2a"/><text x="32" y="41" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#d8ff5b" text-anchor="middle">${initials.replace(/[<>&"]/g, '')}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
