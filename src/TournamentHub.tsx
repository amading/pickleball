import { ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, ImagePlus, LockKeyhole, LogOut, Plus, RefreshCw, Shuffle, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import './tournamentHub.css'
import LiveDrawBoard from './LiveDrawBoard'

type Player = { name: string; gender: 'man' | 'woman' | 'other'; photo: string }
type Registration = { id: string; teamName: string; players: Player[]; status: 'pending' | 'approved' | 'rejected'; createdAt: string }
type DrawTeam = { id: string; teamName: string; players: Player[] }
type Pool = { name: string; court: string; teams: DrawTeam[] }
type DrawMatch = { id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; team1: string | null; team2: string | null; game?: number; score1: number; score2: number; status: 'scheduled' | 'live' | 'final' | 'bye'; winner: string | null; scoreToken?: string }
type Category = {
  id: string; title: string; division: string; format: 'doubles' | 'mixed-doubles' | 'singles';
  eligibility: 'open' | 'men' | 'women' | 'genderless'; fee: number; capacity: number;
  poolSize: number; courts: number; rules: string; published: boolean; approvedCount: number;
  pointsToWin: number; winBy: number; winsToQualify: number;
  registrations?: Registration[]; draw: { pools: Pool[]; matches: DrawMatch[]; publishedAt: string } | null;
  standings?: { name: string; teams: { id: string; teamName: string; wins: number; losses: number; pointsFor: number; pointsAgainst: number }[] }[];
  qualified?: { id: string; teamName: string; wins: number; pool: string }[];
  playoff?: { rounds: { name: string; matches: DrawMatch[] }[]; publishedAt: string } | null
}
type EntryStatus = { id: string; teamName: string; status: Registration['status']; pool: string | null; court: string | null; matches: DrawMatch[] }

const emptyPlayer = (): Player => ({ name: '', gender: 'other', photo: '' })
const newCategory = { title: '', division: 'Newbie', format: 'doubles' as Category['format'], eligibility: 'genderless' as Category['eligibility'], fee: 700, capacity: 20, poolSize: 5, courts: 3, pointsToWin: 11, winBy: 2, winsToQualify: 3, rules: 'Round robin within each pool. Each team plays every other team in its pool once.' }

async function api<T>(path: string, options: RequestInit = {}, pin = ''): Promise<T> {
  let response: Response
  try { response = await fetch(`/api${path}`, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(pin ? { 'x-admin-pin': pin } : {}), ...options.headers } }) }
  catch { throw new Error('Cannot reach the tournament server. Check the Wi-Fi connection and try again.') }
  const data = await response.json().catch(() => null)
  if (!data) throw new Error('The tournament server is not responding. Make sure it is running, then try again.')
  if (!response.ok) throw new Error(data.error || 'Request failed.')
  return data as T
}

function labelFormat(value: Category['format']) { return value === 'mixed-doubles' ? 'Mixed doubles' : value === 'doubles' ? 'Doubles' : 'Singles' }
function labelEligibility(value: Category['eligibility']) { return value === 'genderless' ? 'Genderless' : value === 'open' ? 'Open' : value === 'men' ? 'Men' : 'Women' }
function registrationUrl(id: string, base = window.location.origin) { return `${base}${window.location.pathname}?register=${encodeURIComponent(id)}` }

export function OrganizerHub() {
  const [pin, setPin] = useState(() => window.sessionStorage.getItem('rally-admin-pin') || '')
  const [authenticated, setAuthenticated] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState(newCategory)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [publicBase, setPublicBase] = useState(window.location.origin)
  const selected = categories.find((item) => item.id === selectedId) ?? categories[0]

  useEffect(() => {
    const saved = window.sessionStorage.getItem('rally-admin-pin')
    if (saved && pin === saved) void refresh(saved)
  }, [pin])

  async function refresh(currentPin = pin) {
    try {
      const items = await api<Category[]>('/admin/categories', {}, currentPin)
      setCategories(items)
      setSelectedId((old) => items.some((item) => item.id === old) ? old : items[0]?.id || '')
      setAuthenticated(true)
      setError('')
    } catch (problem) {
      setAuthenticated(false)
      setError((problem as Error).message)
    }
  }

  useEffect(() => {
    void api<{ publicBaseUrl: string }>('/config').then((config) => setPublicBase(config.publicBaseUrl)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!pin || !authenticated) return
    const timer = window.setInterval(() => { void refresh(pin) }, 4000)
    return () => window.clearInterval(timer)
  }, [pin, authenticated])

  async function login(event: React.FormEvent) {
    event.preventDefault()
    try {
      await api('/admin/login', { method: 'POST' }, pin)
      window.sessionStorage.setItem('rally-admin-pin', pin)
      await refresh(pin)
    } catch (problem) { window.sessionStorage.removeItem('rally-admin-pin'); setError((problem as Error).message) }
  }

  function logout() {
    window.sessionStorage.removeItem('rally-admin-pin')
    setPin(''); setAuthenticated(false); setCategories([]); setNotice(''); setError('')
  }

  async function deleteCategory() {
    if (!selected) return
    const played = selected.draw ? ' Its draw, scores, and bracket will be erased too.' : ''
    if (!window.confirm(`Delete "${selected.title}" and all ${selected.registrations?.length ?? 0} registrations?${played} This cannot be undone.`)) return
    setBusy(true); setError('')
    try {
      await api(`/categories/${selected.id}`, { method: 'DELETE' }, pin)
      setSelectedId(''); setNotice(`${selected.title} was deleted.`)
      await refresh()
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  async function createCategory(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const created = await api<Category>('/categories', { method: 'POST', body: JSON.stringify(draft) }, pin)
      setShowCreate(false); setDraft(newCategory); setSelectedId(created.id)
      setNotice('Category is live. Copy its link and share it with players.')
      await refresh()
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  async function updateRegistration(registration: Registration, status: Registration['status']) {
    if (!selected) return
    try {
      await api(`/categories/${selected.id}/registrations/${registration.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }, pin)
      setNotice(`${registration.teamName} marked ${status}.`); await refresh()
    } catch (problem) { setError((problem as Error).message) }
  }

  async function publishDraw() {
    if (!selected) return
    setBusy(true); setError('')
    try {
      await api(`/categories/${selected.id}/draw`, { method: 'POST' }, pin)
      setNotice('Random draw published. Players can now see their pool and matches.'); await refresh()
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  async function setQualifyingWins(wins: number) {
    if (!selected) return
    try {
      await api(`/categories/${selected.id}/qualification`, { method: 'PATCH', body: JSON.stringify({ winsToQualify: wins }) }, pin)
      setNotice(`${wins} wins now qualify for the playoff bracket.`)
      await refresh()
    } catch (problem) { setError((problem as Error).message) }
  }

  async function publishPlayoff() {
    if (!selected) return
    setBusy(true); setError('')
    try {
      await api(`/categories/${selected.id}/playoff`, { method: 'POST' }, pin)
      setNotice('Playoff bracket published. QR scoring now advances winners automatically.')
      await refresh()
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  async function copyLink(id: string) {
    try { await navigator.clipboard.writeText(registrationUrl(id, publicBase)); setNotice('Phone-ready registration link copied.') }
    catch { setNotice(registrationUrl(id, publicBase)) }
  }

  if (!authenticated) return <section className="hub-admin-login"><span className="hub-login-icon"><LockKeyhole size={27} /></span><span className="hub-eyebrow">ORGANIZER ACCESS</span><h2>Run your tournament.</h2><p>Enter the organizer PIN to create categories, review registrations, and publish draws.</p><form onSubmit={login}><input type="password" inputMode="numeric" aria-label="Organizer PIN" placeholder="Organizer PIN" value={pin} onChange={(event) => setPin(event.target.value)} required /><button type="submit">Open organizer desk <ArrowRight size={17} /></button></form>{error && <p className="hub-error">{error}</p>}</section>

  return <div className="hub-admin">
    <div className="hub-admin-hero"><div><span className="hub-eyebrow">ORGANIZER DESK / LIVE OPERATIONS</span><h1>Build the draw.<br /><em>Bring players in.</em></h1><p>Post a category, approve teams, then publish the random pool draw. Every player sees the same assignments through the registration link.</p></div><div className="hub-hero-actions"><button type="button" onClick={() => { setShowCreate(true); setError('') }}><Plus size={18} /> New category</button><button type="button" className="hub-logout" onClick={logout}><LogOut size={16} /> Sign out</button></div></div>
    {notice && <div className="hub-notice"><CheckCircle2 size={18} /> {notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {error && <div className="hub-error">{error}</div>}
    {showCreate && <section className="hub-create"><div className="hub-section-heading"><div><span className="hub-eyebrow">PUBLISH REGISTRATION</span><h2>Create a category</h2></div><button type="button" className="hub-icon-button" aria-label="Close" onClick={() => setShowCreate(false)}><X size={19} /></button></div><form onSubmit={createCategory}>
      <div className="hub-presets"><span>QUICK START</span>{[
        { label: 'Genderless doubles', format: 'doubles', eligibility: 'genderless' },
        { label: 'Men doubles', format: 'doubles', eligibility: 'men' },
        { label: 'Women doubles', format: 'doubles', eligibility: 'women' },
        { label: 'Mixed doubles', format: 'mixed-doubles', eligibility: 'open' },
      ].map((preset) => <button type="button" key={preset.label} onClick={() => setDraft({ ...draft, title: `${draft.division} ${preset.label}`, format: preset.format as Category['format'], eligibility: preset.eligibility as Category['eligibility'] })}>{preset.label}</button>)}</div>
      <div className="hub-form-grid"><label>Category name<input maxLength={60} placeholder="e.g. Newbie Mixed Doubles" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label><label>Division<input maxLength={40} placeholder="e.g. Newbie / Novice / Intermediate" value={draft.division} onChange={(event) => setDraft({ ...draft, division: event.target.value })} required /></label><label>Team format<select value={draft.format} onChange={(event) => setDraft({ ...draft, format: event.target.value as Category['format'], eligibility: event.target.value === 'mixed-doubles' ? 'open' : draft.eligibility })}><option value="doubles">Doubles</option><option value="mixed-doubles">Mixed doubles</option><option value="singles">Singles</option></select></label><label>Eligibility<select value={draft.eligibility} disabled={draft.format === 'mixed-doubles'} onChange={(event) => setDraft({ ...draft, eligibility: event.target.value as Category['eligibility'] })}><option value="genderless">Genderless</option><option value="men">Men</option><option value="women">Women</option><option value="open">Open</option></select></label><label>Fee per player (₱)<input type="number" min="0" value={draft.fee} onChange={(event) => setDraft({ ...draft, fee: Number(event.target.value) })} /></label><label>Team slots<input type="number" min="2" max="128" value={draft.capacity} onChange={(event) => setDraft({ ...draft, capacity: Number(event.target.value) })} /></label><label>Teams per pool<input type="number" min="2" max="12" value={draft.poolSize} onChange={(event) => { const poolSize = Number(event.target.value); setDraft({ ...draft, poolSize, winsToQualify: Math.min(draft.winsToQualify, Math.max(1, poolSize - 1)) }) }} /></label><label>Courts<input type="number" min="1" max="20" value={draft.courts} onChange={(event) => setDraft({ ...draft, courts: Number(event.target.value) })} /></label></div>
      <div className="hub-form-grid hub-scoring-options"><label>Points to win<input type="number" min="1" max="99" value={draft.pointsToWin} onChange={(event) => setDraft({ ...draft, pointsToWin: Number(event.target.value) })} /></label><label>Win by<input type="number" min="1" max="5" value={draft.winBy} onChange={(event) => setDraft({ ...draft, winBy: Number(event.target.value) })} /></label><label>Wins to enter bracket <small>max {Math.max(1, draft.poolSize - 1)} games/team</small><input type="number" min="1" max={Math.max(1, draft.poolSize - 1)} value={draft.winsToQualify} onChange={(event) => setDraft({ ...draft, winsToQualify: Number(event.target.value) })} /></label></div>
      <label>Additional rules shown to players<textarea maxLength={500} rows={3} value={draft.rules} onChange={(event) => setDraft({ ...draft, rules: event.target.value })} required /></label><p className="hub-helper">Draw method: random pool placement, followed by round robin matches inside each pool.</p><div className="hub-form-footer"><span>Posting makes this category visible through its shareable link.</span><button type="submit" disabled={busy}>Publish category <ArrowRight size={17} /></button></div>
    </form></section>}
    <div className="hub-section-heading hub-category-heading"><div><span className="hub-eyebrow">YOUR CATEGORIES</span><h2>Registration board</h2></div><button className="hub-refresh" type="button" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</button></div>
    {categories.length === 0 ? <div className="hub-empty">No categories yet. Create one to open registration.</div> : <><div className="hub-category-tabs">{categories.map((category) => <button type="button" className={category.id === selected?.id ? 'active' : ''} key={category.id} onClick={() => setSelectedId(category.id)}>{category.title}<small>{category.registrations?.length ?? 0} entries</small></button>)}</div>{selected && <>
      <div className="hub-category-summary"><div><span className="hub-eyebrow">{selected.division.toUpperCase()} · {labelFormat(selected.format).toUpperCase()}</span><h2>{selected.title}</h2><p>{labelEligibility(selected.eligibility)} · ₱{selected.fee.toLocaleString()} / player · {selected.capacity} team slots · {selected.poolSize} teams/pool · {selected.courts} courts · First to {selected.pointsToWin}, win by {selected.winBy}</p><small className="hub-share-address">Phone link: {registrationUrl(selected.id, publicBase)}</small></div><div className="hub-summary-actions"><button type="button" onClick={() => void copyLink(selected.id)}><Copy size={16} /> Copy registration link</button><a href={registrationUrl(selected.id)} target="_blank" rel="noreferrer">Preview player page <ArrowRight size={16} /></a><button type="button" className="hub-delete" disabled={busy} onClick={() => void deleteCategory()}><Trash2 size={16} /> Delete</button></div></div>
      <div className="hub-admin-stats"><div><strong>{selected.registrations?.length ?? 0}</strong><span>Total entries</span></div><div><strong>{selected.registrations?.filter((item) => item.status === 'pending').length ?? 0}</strong><span>Need review</span></div><div><strong>{selected.registrations?.filter((item) => item.status === 'approved').length ?? 0}</strong><span>Approved teams</span></div><div><strong>{selected.draw ? selected.draw.pools.length : '—'}</strong><span>Published pools</span></div></div>
      <div className="hub-qualification-control"><div><span className="hub-eyebrow">PLAYOFF RULE</span><strong>Minimum wins to qualify</strong><small>{selected.winsToQualify} / {selected.poolSize - 1} possible pool wins. Each team plays {selected.poolSize - 1} pool games.</small></div><div><button type="button" aria-label="Decrease required wins" disabled={selected.winsToQualify <= 1 || Boolean(selected.playoff)} onClick={() => void setQualifyingWins(selected.winsToQualify - 1)}>−</button><b>{selected.winsToQualify}</b><span className="hub-qualify-max">/ {selected.poolSize - 1}</span><button type="button" aria-label="Increase required wins" disabled={selected.winsToQualify >= selected.poolSize - 1 || Boolean(selected.playoff)} onClick={() => void setQualifyingWins(selected.winsToQualify + 1)}>+</button></div></div>
      <div className="hub-section-heading"><div><span className="hub-eyebrow">TEAM ROSTER</span><h2>Player registrations</h2></div>{!selected.draw && <button className="hub-draw-button" type="button" disabled={busy || (selected.registrations?.filter((item) => item.status === 'approved').length ?? 0) < 2} onClick={() => void publishDraw()}><Shuffle size={17} /> Randomize & publish draw</button>}</div>
      {!selected.draw && <p className="hub-helper">Only approved teams enter the draw. Once published, assignments are locked so players see a stable schedule.</p>}
      <div className="hub-entry-list">{selected.registrations?.length ? selected.registrations.map((entry) => <article className="hub-entry" key={entry.id}><div className="hub-avatar-stack">{entry.players.map((player, index) => <img src={player.photo} alt={player.name} key={index} />)}</div><div className="hub-entry-info"><strong>{entry.teamName}</strong><small>{entry.players.map((player) => player.name).join(' & ')}</small></div><span className={`hub-status ${entry.status}`}>{entry.status}</span>{!selected.draw && <div className="hub-entry-actions"><button type="button" className="approve" onClick={() => void updateRegistration(entry, 'approved')} title="Approve"><Check size={17} /></button><button type="button" className="reject" onClick={() => void updateRegistration(entry, 'rejected')} title="Reject"><X size={17} /></button></div>}</article>) : <div className="hub-empty">No player registrations yet. Share the category link to start collecting teams.</div>}</div>
      {selected.draw && <LiveDrawBoard category={selected} organizer publicBase={publicBase} onPublishPlayoff={() => void publishPlayoff()} busy={busy} />}
    </>}</>}
  </div>
}

async function preparePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP photo.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, 600 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale)
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', 0.78)
    if (data.length > 1_400_000) throw new Error('Photo is still too large. Choose a smaller photo.')
    return data
  } finally { URL.revokeObjectURL(url) }
}

export function RegistrationPortal({ categoryId }: { categoryId: string }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [category, setCategory] = useState<Category | null>(null)
  const [entry, setEntry] = useState<EntryStatus | null>(null)
  const [teamName, setTeamName] = useState('')
  const [players, setPlayers] = useState<Player[]>([emptyPlayer(), emptyPlayer()])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const entryId = new URLSearchParams(window.location.search).get('entry')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        if (categoryId === 'all') { const items = await api<Category[]>('/categories'); if (active) setCategories(items) }
        else {
          const item = await api<Category>(`/categories/${categoryId}`)
          if (active) { setCategory(item); setPlayers((current) => current.length === (item.format === 'singles' ? 1 : 2) ? current : Array.from({ length: item.format === 'singles' ? 1 : 2 }, emptyPlayer)) }
          if (entryId) { const status = await api<EntryStatus>(`/categories/${categoryId}/registration/${entryId}`); if (active) setEntry(status) }
        }
        if (active) { setError(''); setLoading(false) }
      } catch (problem) { if (active) { setError((problem as Error).message); setLoading(false) } }
    }
    void load()
    const timer = window.setInterval(() => { if (categoryId !== 'all') void load() }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [categoryId, entryId])

  async function upload(index: number, file?: File) {
    if (!file) return
    try { const photo = await preparePhoto(file); setPlayers((current) => current.map((player, playerIndex) => playerIndex === index ? { ...player, photo } : player)); setError('') }
    catch (problem) { setError((problem as Error).message) }
  }

  async function register(event: React.FormEvent) {
    event.preventDefault()
    if (!category) return
    if (players.some((player) => !player.photo)) { setError('Add a photo for every player.'); return }
    setBusy(true); setError('')
    try {
      const result = await api<{ id: string; teamName: string; status: EntryStatus['status'] }>(`/categories/${category.id}/register`, { method: 'POST', body: JSON.stringify({ teamName, players }) })
      const url = new URL(window.location.href); url.searchParams.set('entry', result.id); window.history.replaceState({}, '', url)
      setEntry({ ...result, pool: null, court: null, matches: [] })
      setTeamName('')
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  const ownPool = category?.draw?.pools.find((pool) => pool.teams.some((team) => team.id === entry?.id))
  const registeredCount = category?.approvedCount ?? 0
  return <main className="hub-public"><div className="hub-public-inner"><header className="hub-public-top"><a href="?register=all"><img className="hub-brand-logo" src="/pbb-logo.webp" alt="PBB Pickleball" width="600" height="400" /></a><span>PLAYER REGISTRATION</span></header>
    {loading ? <div className="hub-empty">Loading tournament...</div> : categoryId === 'all' ? <><div className="hub-public-hero"><span className="hub-eyebrow">CHOOSE YOUR GAME</span><h1>Find your<br /><em>category.</em></h1><p>Register your team from your phone. Watch this page for your pool and match assignment after the live draw.</p></div><div className="hub-public-grid">{categories.map((item) => <a className="hub-public-category" href={registrationUrl(item.id)} key={item.id}><span>{item.division.toUpperCase()} / {labelFormat(item.format).toUpperCase()}</span><strong>{item.title}</strong><small>{labelEligibility(item.eligibility)} · ₱{item.fee.toLocaleString()} / player</small><div><b>{item.approvedCount} / {item.capacity} approved</b><ArrowRight size={20} /></div></a>)}</div>{categories.length === 0 && <div className="hub-empty">No categories have been posted yet.</div>}</> : category ? <><a className="hub-back" href="?register=all"><ArrowLeft size={16} /> All categories</a><div className="hub-category-hero"><div><span className="hub-eyebrow">{category.division.toUpperCase()} · {labelFormat(category.format).toUpperCase()}</span><h1>{category.title}<em>.</em></h1><p>{category.rules}</p><div className="hub-hero-chips"><span>{labelEligibility(category.eligibility)}</span><span>₱{category.fee.toLocaleString()} / player</span><span>First to {category.pointsToWin}, win by {category.winBy}</span><span>{category.winsToQualify}+ wins to bracket</span><span>{registeredCount} / {category.capacity} approved</span></div></div><div className="hub-hero-orbit"><div><Sparkles size={28} /><strong>PLAY<br />YOUR<br />WAY.</strong></div></div></div>
      {entry ? <section className="hub-entry-status"><div className="hub-section-heading"><div><span className="hub-eyebrow">YOUR TEAM STATUS</span><h2>{entry.teamName}</h2></div><span className={`hub-status ${entry.status}`}>{entry.status}</span></div>{entry.status === 'pending' && <p>Your registration is in. The organizer will review it before the draw.</p>}{entry.status === 'rejected' && <p>This entry was not approved. Contact the organizer for details.</p>}{entry.status === 'approved' && !ownPool && <p>Approved! Check back here for the live random draw.</p>}{ownPool && <div className="hub-your-assignment"><span>YOUR ASSIGNMENT</span><strong>{ownPool.name}</strong><b>{ownPool.court} · {entry.matches.length} pool games</b><p>Your matchups are highlighted in the draw below.</p></div>}<small>Save this page link to check your status and next match later.</small></section> : !category.draw ? <section className="hub-register"><div className="hub-section-heading"><div><span className="hub-eyebrow">JOIN THE LINEUP</span><h2>Register your team</h2></div><span className="hub-open-pill">REGISTRATION OPEN</span></div><p>One form per team. Add each player's name and photo; the organizer will approve the entry.</p><form onSubmit={register}><label className="hub-wide-label">Team name<input maxLength={70} placeholder="What should we call your team?" value={teamName} onChange={(event) => setTeamName(event.target.value)} required /></label><div className="hub-player-grid">{players.map((player, index) => <div className="hub-player-form" key={index}><span className="hub-eyebrow">PLAYER {index + 1}{index === 1 ? ' / PARTNER' : ''}</span><label className="hub-photo-picker">{player.photo ? <img src={player.photo} alt={`Player ${index + 1} preview`} /> : <ImagePlus size={28} />}<span>{player.photo ? 'Change photo' : 'Add player photo'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(index, event.target.files?.[0])} /></label><label>Full name<input maxLength={70} placeholder="First and last name" value={player.name} onChange={(event) => setPlayers((current) => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} required /></label><label>Gender<select value={player.gender} onChange={(event) => setPlayers((current) => current.map((item, i) => i === index ? { ...item, gender: event.target.value as Player['gender'] } : item))}><option value="other">Prefer not to say / other</option><option value="man">Man</option><option value="woman">Woman</option></select></label></div>)}</div>{category.format === 'mixed-doubles' && <p className="hub-helper">Mixed doubles: one man and one woman per team.</p>}{error && <div className="hub-error">{error}</div>}<button className="hub-submit" type="submit" disabled={busy}>Submit registration <ArrowRight size={19} /></button><small>By submitting, you agree to display your team names and photos in the published draw.</small></form></section> : <div className="hub-closed"><CheckCircle2 size={20} /> Registration is closed. The draw is live below.</div>}
      {category.draw && <LiveDrawBoard category={category} ownId={entry?.id} publicBase={window.location.origin} />}
    </> : <div className="hub-error">{error || 'Category not found.'}</div>}
    <footer className="hub-public-footer">PBB PICKLEBALL <span>BUILT FOR THE NEXT GAME</span></footer>
  </div></main>
}
