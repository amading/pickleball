import { CheckCircle2, Copy, QrCode, Radio, ScanLine, Trophy, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import './liveDrawBoard.css'

type Player = { name: string; photo: string }
type Team = { id: string; teamName: string; players: Player[] }
type Match = { id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; game?: number; team1: string | null; team2: string | null; score1: number; score2: number; status: 'scheduled' | 'live' | 'final' | 'bye'; winner: string | null; scoreToken?: string }
type Pool = { name: string; court: string; teams: Team[] }
type Standing = { name: string; teams: { id: string; teamName: string; wins: number; losses: number; pointsFor: number; pointsAgainst: number }[] }
type Qualified = { id: string; teamName: string; wins: number; pool: string }
type Category = { id: string; title: string; winsToQualify: number; draw: { pools: Pool[]; matches: Match[] } | null; standings?: Standing[]; qualified?: Qualified[]; playoff?: { rounds: { name: string; matches: Match[] }[] } | null }

function scoreLink(categoryId: string, match: Match, base: string) { return `${base}${window.location.pathname}?score=${categoryId}.${match.id}.${match.scoreToken}` }

export default function LiveDrawBoard({ category, ownId, organizer = false, publicBase = window.location.origin, onPublishPlayoff, busy = false }: { category: Category; ownId?: string; organizer?: boolean; publicBase?: string; onPublishPlayoff?: () => void; busy?: boolean }) {
  const [poolFilter, setPoolFilter] = useState<string | null>(null)
  const [qrMatch, setQrMatch] = useState<Match | null>(null)
  const [copied, setCopied] = useState(false)
  if (!category.draw) return null
  const pools = category.draw.pools
  const selected = pools.find((pool) => pool.name === poolFilter) ?? pools[0]
  const allTeams = new Map(pools.flatMap((pool) => pool.teams.map((team) => [team.id, team])))
  const poolMatches = category.draw.matches.filter((match) => match.pool === selected.name)
  const poolTable = category.standings?.find((item) => item.name === selected.name)?.teams ?? []
  const finished = category.draw.matches.filter((match) => match.status === 'final').length
  const readyForPlayoff = finished === category.draw.matches.length && (category.qualified?.length ?? 0) >= 2

  function matchCard(match: Match) {
    const first = match.team1 ? allTeams.get(match.team1) : null
    const second = match.team2 ? allTeams.get(match.team2) : null
    const mine = ownId && (match.team1 === ownId || match.team2 === ownId)
    const sides: { team: Team | null; score: number | string }[] = [{ team: first ?? null, score: first ? match.score1 : '-' }, { team: second ?? null, score: second ? match.score2 : '-' }]
    return <article className={`live-match-card ${match.status} ${mine ? 'mine' : ''}`} key={match.id}>
      <div className="live-match-head"><span>{match.stage === 'pool' ? `GAME ${match.game} · ${match.pool?.toUpperCase()}` : `ROUND ${match.round} · PLAYOFF`}</span><b className={`live-match-state ${match.status}`}><i />{match.status === 'final' ? 'FINAL' : match.status === 'live' ? 'LIVE' : match.status === 'bye' ? 'BYE' : 'UP NEXT'}</b></div>
      <div className="live-match-versus">{sides.map(({ team, score }, index) => <div className={`live-match-side ${match.winner === team?.id ? 'winner' : ''}`} key={index}><div className="live-mini-avatars">{team?.players.map((player, playerIndex) => <img src={player.photo} alt="" key={playerIndex} />)}</div><strong>{team?.teamName || 'Winner TBD'}</strong>{match.winner === team?.id && <Trophy size={14} />}<span>{score}</span></div>)}</div>
      <div className="live-match-footer"><span>{match.court} {mine && <em>· YOUR MATCH</em>}</span>{organizer && match.scoreToken && match.status !== 'bye' ? <button type="button" onClick={() => { setQrMatch(match); setCopied(false) }}><QrCode size={16} /> Scoring QR</button> : <span>{match.status === 'final' ? 'Result posted' : match.status === 'live' ? 'Scoring now' : 'Awaiting game'}</span>}</div>
    </article>
  }

  const qrUrl = qrMatch?.scoreToken ? scoreLink(category.id, qrMatch, publicBase) : ''
  return <section className="live-draw-board">
    <div className="live-draw-hero"><div><span className="live-draw-kicker"><Radio size={13} /> LIVE TOURNAMENT BOARD</span><h2>Every point.<br /><em>Every path.</em></h2><p>Scan a match QR to score courtside. Players see scores, pool position, and bracket eligibility as they change.</p></div><div className="live-draw-progress"><strong>{finished}<small>/{category.draw.matches.length}</small></strong><span>POOL GAMES FINAL</span><div><i style={{ width: `${category.draw.matches.length ? finished / category.draw.matches.length * 100 : 0}%` }} /></div></div></div>
    <div className="live-draw-tools"><div><span className="live-draw-eyebrow">POOL STAGE</span><h3>Matches & standings</h3></div><div className="live-draw-rule">Bracket entry <strong>{category.winsToQualify}+ wins</strong></div></div>
    <div className="live-draw-pools" role="tablist" aria-label="Live pool">{pools.map((pool) => <button type="button" role="tab" aria-selected={selected.name === pool.name} className={pool.name === selected.name ? 'active' : ''} key={pool.name} onClick={() => setPoolFilter(pool.name)}>{pool.name}<small>{category.draw!.matches.filter((match) => match.pool === pool.name && match.status === 'final').length} / {category.draw!.matches.filter((match) => match.pool === pool.name).length}</small></button>)}</div>
    <div className="live-draw-layout"><div className="live-match-list">{poolMatches.map(matchCard)}</div><aside className="live-standings"><div className="live-standings-title"><div><span className="live-draw-eyebrow">{selected.name.toUpperCase()}</span><h3>Road to bracket</h3></div><span>{selected.court}</span></div><div className="live-standing-label"><span>TEAM</span><span>W</span><span>L</span></div>{poolTable.map((team, index) => <div className={`live-standing-row ${team.id === ownId ? 'mine' : ''}`} key={team.id}><span>{String(index + 1).padStart(2, '0')}</span><strong>{team.teamName}</strong><b>{team.wins}</b><span>{team.losses}</span>{team.wins >= category.winsToQualify && <em>QUALIFIED</em>}</div>)}<p>Teams with {category.winsToQualify}+ wins become bracket eligible. Ranking ties use point difference, then team name; the playoff draw randomizes eligible teams.</p></aside></div>
    <div className="live-qualifiers"><div><span className="live-draw-eyebrow">PLAYOFF GATE</span><h3>{category.qualified?.length ?? 0} teams have reached {category.winsToQualify} wins</h3><p>All pool results must be final before the organizer publishes the playoff bracket.</p></div>{organizer && !category.playoff && <button type="button" disabled={!readyForPlayoff || busy} onClick={onPublishPlayoff}><Trophy size={17} /> Publish playoff bracket</button>}</div>
    {category.playoff && <div className="live-playoff"><div className="live-draw-tools"><div><span className="live-draw-eyebrow">SINGLE ELIMINATION · PUBLISHED</span><h3>Playoff bracket</h3></div><span className="live-playoff-pill"><CheckCircle2 size={14} /> WINNERS ADVANCE</span></div><div className="live-playoff-rounds">{category.playoff.rounds.map((round) => <section key={round.name}><h4>{round.name}</h4>{round.matches.map(matchCard)}</section>)}</div></div>}
    {qrMatch && <div className="live-qr-backdrop" role="presentation" onClick={() => setQrMatch(null)}><div className="live-qr-dialog" role="dialog" aria-modal="true" aria-label="Match scoring QR" onClick={(event) => event.stopPropagation()}><button className="live-qr-close" type="button" aria-label="Close QR" onClick={() => setQrMatch(null)}><X size={20} /></button><span className="live-draw-eyebrow">SCAN AT THE COURT</span><h3>Score this match live</h3><p>{allTeams.get(qrMatch.team1 || '')?.teamName || 'Winner TBD'} vs {allTeams.get(qrMatch.team2 || '')?.teamName || 'Winner TBD'} · {qrMatch.court}</p><div className="live-qr-code"><QRCodeSVG value={qrUrl} size={210} marginSize={2} /></div><small>Anyone with this QR can update this match until the score is final. Display it only at the assigned court.</small><div className="live-qr-actions"><a href={qrUrl} target="_blank" rel="noreferrer"><ScanLine size={17} /> Open scoreboard</a><button type="button" onClick={async () => { await navigator.clipboard.writeText(qrUrl); setCopied(true) }}><Copy size={17} /> {copied ? 'Copied' : 'Copy link'}</button></div></div></div>}
  </section>
}
