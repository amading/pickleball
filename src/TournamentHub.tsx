import { ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, Download, ImagePlus, LogOut, Pencil, Phone, Plus, RefreshCw, Settings2, Shuffle, Sparkles, Trash2, Undo2, UserCog, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import './tournamentHub.css'
import LiveDrawBoard from './LiveDrawBoard'
import { api, download, readToken, storeToken, type AdminUser } from './adminApi'
import { AccountPanel, LoginGate } from './OrganizerAccess'
import { avatarSrc, qualifyRule } from './liveTypes'

type Player = { name: string; gender: 'man' | 'woman' | 'other'; photo: string }
type Registration = {
  id: string; teamName: string; players: Player[]; status: 'pending' | 'approved' | 'rejected'; createdAt: string
  contact?: string; paymentRef?: string; paid?: boolean
}
type DrawTeam = { id: string; teamName: string; players: Player[] }
type Pool = { name: string; court: string; teams: DrawTeam[] }
type DrawMatch = { id: string; stage: 'pool' | 'playoff'; pool?: string; round?: number; court: string; team1: string | null; team2: string | null; game?: number; score1: number; score2: number; status: 'scheduled' | 'live' | 'final' | 'bye'; winner: string | null; scoreToken?: string }
type QualifyMode = 'top' | 'wins'
type Category = {
  id: string; title: string; division: string; format: 'doubles' | 'mixed-doubles' | 'singles'
  eligibility: 'open' | 'men' | 'women' | 'genderless'; fee: number; capacity: number
  poolSize: number; courts: number; rules: string; published: boolean; approvedCount: number
  pointsToWin: number; winBy: number; winsToQualify: number; qualifyMode: QualifyMode; qualifyTop: number; requirePayment: boolean
  registrations?: Registration[]; draw: { pools: Pool[]; matches: DrawMatch[]; publishedAt: string } | null
  standings?: { name: string; teams: { id: string; teamName: string; wins: number; losses: number; pointsFor: number; pointsAgainst: number; rank?: number }[] }[]
  qualified?: { id: string; teamName: string; wins: number; pool: string }[]
  playoff?: { rounds: { name: string; matches: DrawMatch[] }[]; publishedAt: string } | null
}
type EntryStatus = { id: string; teamName: string; status: Registration['status']; paid?: boolean; requirePayment?: boolean; pool: string | null; court: string | null; matches: DrawMatch[] }
type Settings = {
  title: string; division: string; format: Category['format']; eligibility: Category['eligibility']; fee: number; requirePayment: boolean
  capacity: number; poolSize: number; courts: number; pointsToWin: number; winBy: number
  qualifyMode: QualifyMode; qualifyTop: number; winsToQualify: number; rules: string
}

const emptyPlayer = (): Player => ({ name: '', gender: 'other', photo: '' })
const newCategory: Settings = {
  title: '', division: 'Newbie', format: 'doubles', eligibility: 'genderless', fee: 700, requirePayment: true,
  capacity: 20, poolSize: 5, courts: 3, pointsToWin: 11, winBy: 2, qualifyMode: 'top', qualifyTop: 2, winsToQualify: 3,
  rules: 'Round robin within each pool. Each team plays every other team in its pool once. Top teams advance to a seeded playoff bracket.',
}
const contactPattern = /^[+0-9 ()-]{7,20}$/

function labelFormat(value: Category['format']) { return value === 'mixed-doubles' ? 'Mixed doubles' : value === 'doubles' ? 'Doubles' : 'Singles' }
function labelEligibility(value: Category['eligibility']) { return value === 'genderless' ? 'Genderless' : value === 'open' ? 'Open' : value === 'men' ? 'Men' : 'Women' }
function registrationUrl(id: string, base = window.location.origin) { return `${base}${window.location.pathname}?register=${encodeURIComponent(id)}` }
function hasResults(category: Category) { return [...(category.draw?.matches ?? []), ...(category.playoff?.rounds.flatMap((round) => round.matches) ?? [])].some((match) => match.status === 'live' || match.status === 'final') }
function settingsOf(category: Category): Settings {
  const { title, division, format, eligibility, fee, requirePayment, capacity, poolSize, courts, pointsToWin, winBy, qualifyMode, qualifyTop, winsToQualify, rules } = category
  return { title, division, format, eligibility, fee, requirePayment, capacity, poolSize, courts, pointsToWin, winBy, qualifyMode, qualifyTop, winsToQualify, rules }
}

function CategoryForm({ initial, editing, busy, onSubmit, onClose }: {
  initial: Settings; editing?: Category; busy: boolean; onSubmit: (settings: Settings) => void; onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const set = (patch: Partial<Settings>) => setDraft((current) => ({ ...current, ...patch }))
  const typeLocked = Boolean(editing?.registrations?.length)
  const drawLocked = Boolean(editing?.draw)
  const scoringLocked = Boolean(editing && hasResults(editing))
  const qualifyLocked = Boolean(editing?.playoff)
  const maxWins = Math.max(1, draft.poolSize - 1)
  const lockNote = (locked: boolean, text: string) => locked ? <small>{text}</small> : null

  return <section className="hub-create">
    <div className="hub-section-heading"><div><span className="hub-eyebrow">{editing ? 'EDIT CATEGORY' : 'PUBLISH REGISTRATION'}</span><h2>{editing ? `Edit ${editing.title}` : 'Create a category'}</h2></div><button type="button" className="hub-icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(draft) }}>
      {!editing && <div className="hub-presets"><span>QUICK START</span>{[
        { label: 'Genderless doubles', format: 'doubles', eligibility: 'genderless' },
        { label: 'Men doubles', format: 'doubles', eligibility: 'men' },
        { label: 'Women doubles', format: 'doubles', eligibility: 'women' },
        { label: 'Mixed doubles', format: 'mixed-doubles', eligibility: 'open' },
      ].map((preset) => <button type="button" key={preset.label} onClick={() => set({ title: `${draft.division} ${preset.label}`, format: preset.format as Category['format'], eligibility: preset.eligibility as Category['eligibility'] })}>{preset.label}</button>)}</div>}
      <div className="hub-form-grid">
        <label>Category name<input maxLength={60} placeholder="e.g. Newbie Mixed Doubles" value={draft.title} onChange={(event) => set({ title: event.target.value })} required /></label>
        <label>Division<input maxLength={40} placeholder="e.g. Newbie / Novice / Intermediate" value={draft.division} onChange={(event) => set({ division: event.target.value })} required /></label>
        <label>Team format {lockNote(typeLocked, 'locked: teams registered')}<select value={draft.format} disabled={typeLocked} onChange={(event) => set({ format: event.target.value as Category['format'], eligibility: event.target.value === 'mixed-doubles' ? 'open' : draft.eligibility })}><option value="doubles">Doubles</option><option value="mixed-doubles">Mixed doubles</option><option value="singles">Singles</option></select></label>
        <label>Eligibility<select value={draft.eligibility} disabled={typeLocked || draft.format === 'mixed-doubles'} onChange={(event) => set({ eligibility: event.target.value as Category['eligibility'] })}><option value="genderless">Genderless</option><option value="men">Men</option><option value="women">Women</option><option value="open">Open</option></select></label>
        <label>Fee per player (₱)<input type="number" min="0" value={draft.fee} onChange={(event) => set({ fee: Number(event.target.value) })} required /></label>
        <label>Team slots<input type="number" min={Math.max(2, editing?.registrations?.filter((item) => item.status !== 'rejected').length ?? 2)} max="128" value={draft.capacity} onChange={(event) => set({ capacity: Number(event.target.value) })} required /></label>
        <label>Teams per pool {lockNote(drawLocked, 'locked: draw published')}<input type="number" min="2" max="12" disabled={drawLocked} value={draft.poolSize} onChange={(event) => { const poolSize = Number(event.target.value); set({ poolSize, winsToQualify: Math.min(draft.winsToQualify, Math.max(1, poolSize - 1)), qualifyTop: Math.min(draft.qualifyTop, poolSize) }) }} required /></label>
        <label>Courts {lockNote(drawLocked, 'locked: draw published')}<input type="number" min="1" max="20" disabled={drawLocked} value={draft.courts} onChange={(event) => set({ courts: Number(event.target.value) })} required /></label>
      </div>
      <label className="hub-check"><input type="checkbox" checked={draft.requirePayment} onChange={(event) => set({ requirePayment: event.target.checked })} /> Require payment before a team can be approved</label>
      <div className="hub-form-grid hub-scoring-options">
        <label>Points to win {lockNote(scoringLocked, 'locked: scores recorded')}<input type="number" min="1" max="99" disabled={scoringLocked} value={draft.pointsToWin} onChange={(event) => set({ pointsToWin: Number(event.target.value) })} required /></label>
        <label>Win by<input type="number" min="1" max="5" disabled={scoringLocked} value={draft.winBy} onChange={(event) => set({ winBy: Number(event.target.value) })} required /></label>
        <label>Who enters the playoffs {lockNote(qualifyLocked, 'locked: bracket published')}<select value={draft.qualifyMode} disabled={qualifyLocked} onChange={(event) => set({ qualifyMode: event.target.value as QualifyMode })}><option value="top">Top teams per pool (seeded bracket)</option><option value="wins">Minimum wins (random bracket)</option></select></label>
        {draft.qualifyMode === 'top'
          ? <label>Teams per pool that advance<input type="number" min="1" max={draft.poolSize} disabled={qualifyLocked} value={draft.qualifyTop} onChange={(event) => set({ qualifyTop: Number(event.target.value) })} required /></label>
          : <label>Wins to enter bracket <small>max {maxWins} games/team</small><input type="number" min="1" max={maxWins} disabled={qualifyLocked} value={draft.winsToQualify} onChange={(event) => set({ winsToQualify: Number(event.target.value) })} required /></label>}
      </div>
      <label>Additional rules shown to players<textarea maxLength={500} rows={3} value={draft.rules} onChange={(event) => set({ rules: event.target.value })} required /></label>
      <p className="hub-helper">Draw method: random pool placement, then round robin inside each pool. Games are spread across every court so no court sits idle. Ties: head-to-head, then point difference, then points scored.</p>
      <div className="hub-form-footer"><span>{editing ? 'Players see changes on their next refresh.' : 'Posting makes this category visible through its shareable link.'}</span><button type="submit" disabled={busy}>{editing ? 'Save changes' : 'Publish category'} <ArrowRight size={17} /></button></div>
    </form>
  </section>
}

function EntryEditor({ entry, busy, onSave, onCancel }: { entry: Registration; busy: boolean; onSave: (patch: Record<string, unknown>) => void; onCancel: () => void }) {
  const [teamName, setTeamName] = useState(entry.teamName)
  const [playerNames, setPlayerNames] = useState(entry.players.map((player) => player.name))
  const [contact, setContact] = useState(entry.contact ?? '')
  const [paymentRef, setPaymentRef] = useState(entry.paymentRef ?? '')
  return <form className="hub-entry-edit" onSubmit={(event) => { event.preventDefault(); onSave({ teamName, playerNames, contact, paymentRef }) }}>
    <label>Team name<input maxLength={70} value={teamName} onChange={(event) => setTeamName(event.target.value)} required /></label>
    {playerNames.map((name, index) => <label key={index}>Player {index + 1}<input maxLength={70} value={name} onChange={(event) => setPlayerNames((current) => current.map((item, i) => i === index ? event.target.value : item))} required /></label>)}
    <label>Contact number<input type="tel" maxLength={20} value={contact} pattern="[+0-9 ()\-]{7,20}" onChange={(event) => setContact(event.target.value)} required /></label>
    <label>Payment reference<input maxLength={60} value={paymentRef} onChange={(event) => setPaymentRef(event.target.value)} /></label>
    <div><button type="submit" disabled={busy}>Save</button><button type="button" className="secondary" onClick={onCancel}>Cancel</button></div>
  </form>
}

export function OrganizerHub() {
  const [token, setToken] = useState(readToken)
  const [user, setUser] = useState<AdminUser | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<'create' | 'edit' | null>(null)
  const [editingEntry, setEditingEntry] = useState('')
  const [entryFilter, setEntryFilter] = useState<'all' | 'pending' | 'unpaid' | 'approved'>('all')
  const [publicBase, setPublicBase] = useState(window.location.origin)
  const selected = categories.find((item) => item.id === selectedId) ?? categories[0]

  const authenticated = Boolean(user)

  useEffect(() => {
    if (!token) return
    api<{ user: AdminUser }>('/admin/me', {}, token).then((result) => { setUser(result.user); void refresh(token) }).catch((problem) => {
      // An expired or revoked session sends the organizer back to sign in.
      if ((problem as { status?: number }).status === 401) signOutLocally()
      else setError((problem as Error).message)
    })
  }, [token])

  async function refresh(currentToken = token) {
    try {
      const items = await api<Category[]>('/admin/categories', {}, currentToken)
      setCategories(items)
      setSelectedId((old) => items.some((item) => item.id === old) ? old : items[0]?.id || '')
      setError('')
    } catch (problem) {
      if ((problem as { status?: number }).status === 401) signOutLocally()
      setError((problem as Error).message)
    }
  }

  function signOutLocally() {
    storeToken('')
    setToken(''); setUser(null); setCategories([]); setShowAccount(false); setForm(null)
  }

  useEffect(() => {
    void api<{ publicBaseUrl: string }>('/config').then((config) => setPublicBase(config.publicBaseUrl)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!token || !authenticated) return
    const timer = window.setInterval(() => { void refresh(token) }, 4000)
    return () => window.clearInterval(timer)
  }, [token, authenticated])

  /** Runs one organizer action with a shared busy flag, success notice, and refresh. */
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError('')
    try { await action(); if (success) setNotice(success); await refresh() }
    catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  function signedIn(nextToken: string, nextUser: AdminUser) {
    storeToken(nextToken)
    setUser(nextUser); setToken(nextToken); setError(''); setNotice(`Welcome, ${nextUser.name}.`)
  }

  function logout() {
    void api('/admin/logout', { method: 'POST' }, token).catch(() => {})
    signOutLocally(); setNotice(''); setError('')
  }

  function saveCategory(settings: Settings) {
    if (form === 'edit' && selected) {
      void run(async () => { await api(`/categories/${selected.id}`, { method: 'PATCH', body: JSON.stringify(settings) }, token); setForm(null) }, `${settings.title} updated.`)
    } else {
      void run(async () => {
        const created = await api<Category>('/categories', { method: 'POST', body: JSON.stringify(settings) }, token)
        setForm(null); setSelectedId(created.id)
      }, 'Category is live. Copy its link and share it with players.')
    }
  }

  function deleteCategory() {
    if (!selected) return
    const played = selected.draw ? ' Its draw, scores, and bracket will be erased too.' : ''
    if (!window.confirm(`Delete "${selected.title}" and all ${selected.registrations?.length ?? 0} registrations?${played} A backup is saved first, but the category disappears for everyone.`)) return
    void run(async () => { await api(`/categories/${selected.id}`, { method: 'DELETE' }, token); setSelectedId('') }, `${selected.title} was deleted. A backup copy was saved on the server.`)
  }

  function patchEntry(entry: Registration, patch: Record<string, unknown>, success: string) {
    if (!selected) return
    void run(async () => { await api(`/categories/${selected.id}/registrations/${entry.id}`, { method: 'PATCH', body: JSON.stringify(patch) }, token); setEditingEntry('') }, success)
  }

  function setQualification(patch: Partial<Settings>) {
    if (!selected) return
    void run(() => api(`/categories/${selected.id}`, { method: 'PATCH', body: JSON.stringify(patch) }, token), '')
  }

  function undoDraw() {
    if (!selected || !window.confirm('Undo the draw? Pools and matches are removed so you can change entries and draw again. Players will see registration reopen.')) return
    void run(() => api(`/categories/${selected.id}/draw`, { method: 'DELETE' }, token), 'Draw undone. Entries are editable again.')
  }

  function exportFile(path: string, name: string) {
    setError('')
    download(path, token, name).catch((problem) => setError((problem as Error).message))
  }

  async function copyLink(id: string) {
    try { await navigator.clipboard.writeText(registrationUrl(id, publicBase)); setNotice('Phone-ready registration link copied.') }
    catch { setNotice(registrationUrl(id, publicBase)) }
  }

  if (!user) return token ? <div className="hub-empty">{error || 'Signing in...'}</div> : <LoginGate onSignedIn={signedIn} />

  const entries = selected?.registrations ?? []
  const unpaid = entries.filter((item) => item.status !== 'rejected' && !item.paid)
  const shownEntries = entries.filter((item) => entryFilter === 'all' || (entryFilter === 'unpaid' ? item.status !== 'rejected' && !item.paid : item.status === entryFilter))
  const approvedCount = entries.filter((item) => item.status === 'approved').length
  const maxWins = Math.max(1, (selected?.poolSize ?? 2) - 1)

  return <div className="hub-admin">
    <div className="hub-admin-hero"><div><span className="hub-eyebrow">ORGANIZER DESK / LIVE OPERATIONS</span><h1>Build the draw.<br /><em>Bring players in.</em></h1><p>Post a category, confirm payments, approve teams, then publish the random pool draw. Every player sees the same assignments through the registration link.</p></div><div className="hub-hero-actions"><button type="button" onClick={() => { setForm('create'); setError('') }}><Plus size={18} /> New category</button><button type="button" className="hub-logout" onClick={() => setShowAccount((open) => !open)}><UserCog size={16} /> {user.name}</button><button type="button" className="hub-logout" onClick={logout}><LogOut size={16} /> Sign out</button></div></div>
    {showAccount && <AccountPanel token={token} user={user} onClose={() => setShowAccount(false)} />}
    {notice && <div className="hub-notice"><CheckCircle2 size={18} /> {notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {error && <div className="hub-error">{error}</div>}
    {form === 'create' && <CategoryForm initial={newCategory} busy={busy} onSubmit={saveCategory} onClose={() => setForm(null)} />}
    <div className="hub-section-heading hub-category-heading"><div><span className="hub-eyebrow">YOUR CATEGORIES</span><h2>Registration board</h2></div><div className="hub-heading-tools"><button className="hub-refresh" type="button" onClick={() => exportFile('/admin/backup', 'pbb-backup.json')}><Download size={15} /> Full backup</button><button className="hub-refresh" type="button" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</button></div></div>
    {categories.length === 0 ? <div className="hub-empty">No categories yet. Create one to open registration.</div> : <>
      <div className="hub-category-tabs">{categories.map((category) => <button type="button" className={category.id === selected?.id ? 'active' : ''} key={category.id} onClick={() => { setSelectedId(category.id); setForm((current) => current === 'edit' ? null : current); setEditingEntry('') }}>{category.title}<small>{category.registrations?.length ?? 0} entries</small></button>)}</div>
      {selected && <>
        <div className="hub-category-summary">
          <div><span className="hub-eyebrow">{selected.division.toUpperCase()} · {labelFormat(selected.format).toUpperCase()}</span><h2>{selected.title}</h2><p>{labelEligibility(selected.eligibility)} · ₱{selected.fee.toLocaleString()} / player{selected.requirePayment ? ' (payment required)' : ''} · {selected.capacity} team slots · {selected.poolSize} teams/pool · {selected.courts} courts · First to {selected.pointsToWin}, win by {selected.winBy} · {qualifyRule(selected)} to playoffs</p><small className="hub-share-address">Phone link: {registrationUrl(selected.id, publicBase)}</small></div>
          <div className="hub-summary-actions">
            <button type="button" onClick={() => void copyLink(selected.id)}><Copy size={16} /> Copy registration link</button>
            <a href={registrationUrl(selected.id)} target="_blank" rel="noreferrer">Preview player page <ArrowRight size={16} /></a>
            <button type="button" onClick={() => { setForm('edit'); setError('') }}><Settings2 size={16} /> Edit settings</button>
            <button type="button" className="hub-delete" disabled={busy} onClick={deleteCategory}><Trash2 size={16} /> Delete</button>
          </div>
        </div>
        {form === 'edit' && <CategoryForm key={selected.id} initial={settingsOf(selected)} editing={selected} busy={busy} onSubmit={saveCategory} onClose={() => setForm(null)} />}
        <div className="hub-admin-stats">
          <div><strong>{entries.length}</strong><span>Total entries</span></div>
          <div><strong>{entries.filter((item) => item.status === 'pending').length}</strong><span>Need review</span></div>
          <div><strong>{unpaid.length}</strong><span>Not yet paid</span></div>
          <div><strong>{approvedCount}</strong><span>Approved teams</span></div>
        </div>
        <div className="hub-export-row"><span>EXPORT CSV</span>
          <button type="button" onClick={() => exportFile(`/categories/${selected.id}/export?kind=registrations`, 'registrations.csv')}><Download size={14} /> Registrations & payments</button>
          <button type="button" disabled={!selected.draw} onClick={() => exportFile(`/categories/${selected.id}/export?kind=results`, 'results.csv')}><Download size={14} /> Match results</button>
          <button type="button" disabled={!selected.draw} onClick={() => exportFile(`/categories/${selected.id}/export?kind=standings`, 'standings.csv')}><Download size={14} /> Standings</button>
        </div>
        <div className="hub-qualification-control">
          <div><span className="hub-eyebrow">PLAYOFF RULE</span><strong>{qualifyRule(selected)}</strong><small>{selected.qualifyMode === 'top' ? 'Seeded bracket: pool winners meet runners-up from other pools first.' : `Random bracket among teams with ${selected.winsToQualify}+ of ${maxWins} possible pool wins.`} Ties: head-to-head, then point difference.</small></div>
          <div>
            <select aria-label="Playoff rule" value={selected.qualifyMode} disabled={busy || Boolean(selected.playoff)} onChange={(event) => setQualification({ qualifyMode: event.target.value as QualifyMode })}><option value="top">Top per pool</option><option value="wins">Minimum wins</option></select>
            {selected.qualifyMode === 'top' ? <>
              <button type="button" aria-label="Fewer teams advance" disabled={busy || selected.qualifyTop <= 1 || Boolean(selected.playoff)} onClick={() => setQualification({ qualifyTop: selected.qualifyTop - 1 })}>−</button><b>{selected.qualifyTop}</b>
              <button type="button" aria-label="More teams advance" disabled={busy || selected.qualifyTop >= selected.poolSize || Boolean(selected.playoff)} onClick={() => setQualification({ qualifyTop: selected.qualifyTop + 1 })}>+</button>
            </> : <>
              <button type="button" aria-label="Decrease required wins" disabled={busy || selected.winsToQualify <= 1 || Boolean(selected.playoff)} onClick={() => setQualification({ winsToQualify: selected.winsToQualify - 1 })}>−</button><b>{selected.winsToQualify}</b><span className="hub-qualify-max">/ {maxWins}</span>
              <button type="button" aria-label="Increase required wins" disabled={busy || selected.winsToQualify >= maxWins || Boolean(selected.playoff)} onClick={() => setQualification({ winsToQualify: selected.winsToQualify + 1 })}>+</button>
            </>}
          </div>
        </div>
        <div className="hub-section-heading"><div><span className="hub-eyebrow">TEAM ROSTER</span><h2>Player registrations</h2></div>
          {!selected.draw
            ? <button className="hub-draw-button" type="button" disabled={busy || approvedCount < 2} onClick={() => void run(() => api(`/categories/${selected.id}/draw`, { method: 'POST' }, token), 'Random draw published. Players can now see their pool and matches.')}><Shuffle size={17} /> Randomize & publish draw</button>
            : !hasResults(selected) && <button className="hub-undo-button" type="button" disabled={busy} onClick={undoDraw}><Undo2 size={16} /> Undo draw</button>}
        </div>
        {!selected.draw && <p className="hub-helper">Only approved teams enter the draw.{selected.requirePayment ? ' Mark a team paid before approving it.' : ''} Once published, entries lock so players see a stable schedule; you can undo the draw until the first point is scored.</p>}
        <div className="hub-entry-filters" role="tablist" aria-label="Filter entries">{([['all', 'All', entries.length], ['pending', 'Need review', entries.filter((item) => item.status === 'pending').length], ['unpaid', 'Unpaid', unpaid.length], ['approved', 'Approved', approvedCount]] as const).map(([id, label, count]) => <button type="button" role="tab" aria-selected={entryFilter === id} className={entryFilter === id ? 'active' : ''} key={id} onClick={() => setEntryFilter(id)}>{label} <span>{count}</span></button>)}</div>
        <div className="hub-entry-list">{shownEntries.length ? shownEntries.map((entry) => {
          const needsPayment = selected.requirePayment && !entry.paid
          return <article className="hub-entry" key={entry.id}>
            <div className="hub-avatar-stack">{entry.players.map((player, index) => <img src={avatarSrc(player.name, player.photo)} alt={player.name} key={index} />)}</div>
            <div className="hub-entry-info">
              <strong>{entry.teamName}</strong>
              <small>{entry.players.map((player) => player.name).join(' & ')}</small>
              <small className="hub-entry-meta">{entry.contact ? <a href={`tel:${entry.contact.replace(/[^+0-9]/g, '')}`}><Phone size={11} /> {entry.contact}</a> : 'No contact number'}{entry.paymentRef ? ` · Ref ${entry.paymentRef}` : ''}</small>
            </div>
            <button type="button" className={`hub-paid ${entry.paid ? 'paid' : ''}`} disabled={busy || entry.status === 'rejected'} onClick={() => patchEntry(entry, { paid: !entry.paid }, `${entry.teamName} marked ${entry.paid ? 'unpaid' : 'paid'}.`)} title={entry.paid ? 'Mark as not paid' : 'Mark as paid'}>{entry.paid ? 'PAID' : 'UNPAID'}</button>
            <span className={`hub-status ${entry.status}`}>{entry.status}</span>
            <div className="hub-entry-actions">
              {!selected.draw && <>
                <button type="button" className="approve" disabled={busy || entry.status === 'approved' || needsPayment} onClick={() => patchEntry(entry, { status: 'approved' }, `${entry.teamName} approved.`)} title={needsPayment ? 'Mark paid first' : 'Approve'}><Check size={17} /></button>
                <button type="button" className="reject" disabled={busy || entry.status === 'rejected'} onClick={() => patchEntry(entry, { status: 'rejected' }, `${entry.teamName} rejected.`)} title="Reject"><X size={17} /></button>
              </>}
              <button type="button" className="edit" onClick={() => setEditingEntry(editingEntry === entry.id ? '' : entry.id)} title="Edit names and contact"><Pencil size={15} /></button>
            </div>
            {editingEntry === entry.id && <EntryEditor entry={entry} busy={busy} onCancel={() => setEditingEntry('')} onSave={(patch) => patchEntry(entry, patch, `${entry.teamName} updated.`)} />}
          </article>
        }) : <div className="hub-empty">{entries.length ? 'No entries match this filter.' : 'No player registrations yet. Share the category link to start collecting teams.'}</div>}</div>
        {selected.draw && <LiveDrawBoard category={selected} organizer publicBase={publicBase} onPublishPlayoff={() => void run(() => api(`/categories/${selected.id}/playoff`, { method: 'POST' }, token), 'Playoff bracket published. QR scoring now advances winners automatically.')} busy={busy} />}
      </>}
    </>}
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
  const [contact, setContact] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
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
    if (!contactPattern.test(contact.trim()) || contact.replace(/\D/g, '').length < 7) { setError('Enter a contact mobile number, e.g. 0917 123 4567.'); return }
    setBusy(true); setError('')
    try {
      const result = await api<{ id: string; teamName: string; status: EntryStatus['status'] }>(`/categories/${category.id}/register`, { method: 'POST', body: JSON.stringify({ teamName, contact, paymentRef, players }) })
      const url = new URL(window.location.href); url.searchParams.set('entry', result.id); window.history.replaceState({}, '', url)
      setEntry({ ...result, paid: false, requirePayment: category.requirePayment, pool: null, court: null, matches: [] })
      setTeamName('')
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  const ownPool = category?.draw?.pools.find((pool) => pool.teams.some((team) => team.id === entry?.id))
  const registeredCount = category?.approvedCount ?? 0
  return <main className="hub-public"><div className="hub-public-inner"><header className="hub-public-top"><a href="?register=all"><img className="hub-brand-logo" src="/pbb-logo.webp" alt="PBB Pickleball" width="600" height="400" /></a><span>PLAYER REGISTRATION</span></header>
    {loading ? <div className="hub-empty">Loading tournament...</div> : categoryId === 'all' ? <>
      <div className="hub-public-hero"><span className="hub-eyebrow">CHOOSE YOUR GAME</span><h1>Find your<br /><em>category.</em></h1><p>Register your team from your phone. Watch this page for your pool and match assignment after the live draw.</p></div>
      <div className="hub-public-grid">{categories.map((item) => <a className="hub-public-category" href={registrationUrl(item.id)} key={item.id}><span>{item.division.toUpperCase()} / {labelFormat(item.format).toUpperCase()}</span><strong>{item.title}</strong><small>{labelEligibility(item.eligibility)} · ₱{item.fee.toLocaleString()} / player</small><div><b>{item.draw ? 'Draw is live' : `${item.approvedCount} / ${item.capacity} approved`}</b><ArrowRight size={20} /></div></a>)}</div>
      {categories.length === 0 && <div className="hub-empty">{error || 'No categories have been posted yet.'}</div>}
    </> : category ? <>
      <a className="hub-back" href="?register=all"><ArrowLeft size={16} /> All categories</a>
      <div className="hub-category-hero"><div><span className="hub-eyebrow">{category.division.toUpperCase()} · {labelFormat(category.format).toUpperCase()}</span><h1>{category.title}<em>.</em></h1><p>{category.rules}</p><div className="hub-hero-chips"><span>{labelEligibility(category.eligibility)}</span><span>₱{category.fee.toLocaleString()} / player</span><span>First to {category.pointsToWin}, win by {category.winBy}</span><span>{qualifyRule(category)} to playoffs</span><span>{registeredCount} / {category.capacity} approved</span></div></div><div className="hub-hero-orbit"><div><Sparkles size={28} /><strong>PLAY<br />YOUR<br />WAY.</strong></div></div></div>
      {entry ? <section className="hub-entry-status">
        <div className="hub-section-heading"><div><span className="hub-eyebrow">YOUR TEAM STATUS</span><h2>{entry.teamName}</h2></div><span className={`hub-status ${entry.status}`}>{entry.status}</span></div>
        {entry.requirePayment && entry.status !== 'rejected' && <p className={`hub-payment-line ${entry.paid ? 'paid' : ''}`}>{entry.paid ? 'Payment confirmed by the organizer.' : `Payment not yet confirmed. Pay ₱${category.fee.toLocaleString()} per player to the organizer; your team is approved after payment is checked.`}</p>}
        {entry.status === 'pending' && <p>Your registration is in. The organizer will review it before the draw.</p>}
        {entry.status === 'rejected' && <p>This entry was not approved. Contact the organizer for details.</p>}
        {entry.status === 'approved' && !ownPool && <p>Approved! Check back here for the live random draw.</p>}
        {ownPool && <div className="hub-your-assignment"><span>YOUR ASSIGNMENT</span><strong>{ownPool.name}</strong><b>{ownPool.court} · {entry.matches.length} pool games</b><p>Your matchups are highlighted in the draw below.</p></div>}
        <small>Save this page link to check your status and next match later.</small>
      </section> : !category.draw ? <section className="hub-register">
        <div className="hub-section-heading"><div><span className="hub-eyebrow">JOIN THE LINEUP</span><h2>Register your team</h2></div><span className="hub-open-pill">REGISTRATION OPEN</span></div>
        <p>One form per team. Add each player's name and photo; the organizer will approve the entry.{category.requirePayment ? ` Entry fee is ₱${category.fee.toLocaleString()} per player; teams are approved once payment is confirmed.` : ''}</p>
        <form onSubmit={register}>
          <label className="hub-wide-label">Team name<input maxLength={70} placeholder="What should we call your team?" value={teamName} onChange={(event) => setTeamName(event.target.value)} required /></label>
          <div className="hub-player-grid">{players.map((player, index) => <div className="hub-player-form" key={index}><span className="hub-eyebrow">PLAYER {index + 1}{index === 1 ? ' / PARTNER' : ''}</span><label className="hub-photo-picker">{player.photo ? <img src={player.photo} alt={`Player ${index + 1} preview`} /> : <ImagePlus size={28} />}<span>{player.photo ? 'Change photo' : 'Add player photo'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(index, event.target.files?.[0])} /></label><label>Full name<input maxLength={70} placeholder="First and last name" value={player.name} onChange={(event) => setPlayers((current) => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} required /></label><label>Gender<select value={player.gender} onChange={(event) => setPlayers((current) => current.map((item, i) => i === index ? { ...item, gender: event.target.value as Player['gender'] } : item))}><option value="other">Prefer not to say / other</option><option value="man">Man</option><option value="woman">Woman</option></select></label></div>)}</div>
          <div className="hub-player-grid hub-contact-grid">
            <label className="hub-wide-label">Contact mobile number<input type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="0917 123 4567" value={contact} onChange={(event) => setContact(event.target.value)} required /><small>Only the organizer sees this, for game calls and updates.</small></label>
            {category.fee > 0 && <label className="hub-wide-label">GCash / payment reference <em>(optional)</em><input maxLength={60} placeholder="Reference no. if already paid" value={paymentRef} onChange={(event) => setPaymentRef(event.target.value)} /><small>Helps the organizer match your payment.</small></label>}
          </div>
          {category.format === 'mixed-doubles' && <p className="hub-helper">Mixed doubles: one man and one woman per team.</p>}
          {error && <div className="hub-error">{error}</div>}
          <button className="hub-submit" type="submit" disabled={busy}>Submit registration <ArrowRight size={19} /></button>
          <small>By submitting, you agree to display your team names and photos in the published draw.</small>
        </form>
      </section> : <div className="hub-closed"><CheckCircle2 size={20} /> Registration is closed. The draw is live below.</div>}
      {category.draw && <LiveDrawBoard category={category} ownId={entry?.id} publicBase={window.location.origin} />}
    </> : <div className="hub-error">{error || 'Category not found.'}</div>}
    <footer className="hub-public-footer">PBB PICKLEBALL <span>BUILT FOR THE NEXT GAME</span></footer>
  </div></main>
}
