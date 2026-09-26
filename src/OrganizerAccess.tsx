import { ArrowRight, History, KeyRound, LockKeyhole, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type AdminUser } from './adminApi'

type Mode = 'loading' | 'setup' | 'login' | 'recover'
type Activity = { at: string; by: string; username: string | null; action: string; category: string | null; detail: string }

/** Sign-in screen: first-run owner setup, normal login, or password reset with the setup PIN. */
export function LoginGate({ onSignedIn }: { onSignedIn: (token: string, user: AdminUser) => void }) {
  const [mode, setMode] = useState<Mode>('loading')
  const [form, setForm] = useState({ pin: '', name: '', username: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }))

  useEffect(() => {
    api<{ needsSetup: boolean }>('/admin/status').then((status) => setMode(status.needsSetup ? 'setup' : 'login')).catch((problem) => { setError((problem as Error).message); setMode('login') })
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (mode !== 'login' && form.password !== form.confirm) { setError('The two passwords do not match.'); return }
    setBusy(true); setError('')
    try {
      const path = mode === 'setup' ? '/admin/setup' : mode === 'recover' ? '/admin/recover' : '/admin/login'
      const result = await api<{ token: string; user: AdminUser }>(path, { method: 'POST', body: JSON.stringify(form) })
      onSignedIn(result.token, result.user)
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  const title = mode === 'setup' ? 'Create the owner account.' : mode === 'recover' ? 'Reset a password.' : 'Run your tournament.'
  const intro = mode === 'setup'
    ? 'First time here. Enter the setup PIN printed in the server terminal, then choose your own username and password. You can add other organizers after.'
    : mode === 'recover'
      ? 'Enter the setup PIN from the server terminal, the username, and a new password.'
      : 'Sign in with your organizer account to manage categories, payments, draws, and scores.'

  return <section className="hub-admin-login">
    <span className="hub-login-icon"><LockKeyhole size={27} /></span>
    <span className="hub-eyebrow">ORGANIZER ACCESS</span>
    <h2>{title}</h2>
    <p>{intro}</p>
    {mode === 'loading' ? <p>Checking the server...</p> : <form onSubmit={submit} className="hub-login-form">
      {mode !== 'login' && <input type="password" inputMode="numeric" autoComplete="off" aria-label="Setup PIN" placeholder="Setup PIN (from the server terminal)" value={form.pin} onChange={(event) => set({ pin: event.target.value })} required />}
      {mode === 'setup' && <input aria-label="Your name" autoComplete="name" placeholder="Your name" maxLength={60} value={form.name} onChange={(event) => set({ name: event.target.value })} required />}
      <input aria-label="Username" autoComplete="username" autoCapitalize="none" placeholder="Username" maxLength={32} value={form.username} onChange={(event) => set({ username: event.target.value })} required />
      <input type="password" aria-label={mode === 'login' ? 'Password' : 'New password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Password' : 'New password (8+ characters)'} minLength={mode === 'login' ? undefined : 8} value={form.password} onChange={(event) => set({ password: event.target.value })} required />
      {mode !== 'login' && <input type="password" aria-label="Repeat password" autoComplete="new-password" placeholder="Repeat password" value={form.confirm} onChange={(event) => set({ confirm: event.target.value })} required />}
      <button type="submit" disabled={busy}>{mode === 'setup' ? 'Create owner account' : mode === 'recover' ? 'Reset and sign in' : 'Open organizer desk'} <ArrowRight size={17} /></button>
    </form>}
    {mode === 'login' && <button type="button" className="hub-link-button" onClick={() => { setMode('recover'); setError('') }}>Forgot password? Reset with the setup PIN</button>}
    {mode === 'recover' && <button type="button" className="hub-link-button" onClick={() => { setMode('login'); setError('') }}>Back to sign in</button>}
    {error && <p className="hub-error">{error}</p>}
  </section>
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never'
}

/** Account settings, organizer management (owner), and the activity log. */
export function AccountPanel({ token, user, onClose }: { token: string; user: AdminUser; onClose: () => void }) {
  const [tab, setTab] = useState<'me' | 'team' | 'activity'>(user.role === 'owner' ? 'team' : 'me')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [activity, setActivity] = useState<Activity[] | null>(null)
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [invite, setInvite] = useState({ name: '', username: '', password: '', role: 'organizer' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (tab === 'team' && user.role === 'owner') api<AdminUser[]>('/admin/users', {}, token).then(setUsers).catch((problem) => setError((problem as Error).message))
    if (tab === 'activity') api<Activity[]>('/admin/activity', {}, token).then(setActivity).catch((problem) => setError((problem as Error).message))
  }, [tab, token, user.role])

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(success) } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) }
  }

  function changePassword(event: React.FormEvent) {
    event.preventDefault()
    if (passwords.next !== passwords.confirm) { setError('The new passwords do not match.'); return }
    void run(async () => { await api('/admin/password', { method: 'POST', body: JSON.stringify(passwords) }, token); setPasswords({ current: '', next: '', confirm: '' }) }, 'Password changed. Other devices were signed out.')
  }

  function addOrganizer(event: React.FormEvent) {
    event.preventDefault()
    void run(async () => {
      const created = await api<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(invite) }, token)
      setUsers((current) => [...current, created]); setInvite({ name: '', username: '', password: '', role: 'organizer' })
    }, `Added ${invite.name}. Share the username and temporary password with them privately.`)
  }

  function updateUser(target: AdminUser, patch: Record<string, unknown>, success: string) {
    void run(async () => {
      const updated = await api<AdminUser>(`/admin/users/${target.id}`, { method: 'PATCH', body: JSON.stringify(patch) }, token)
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item))
    }, success)
  }

  function resetPassword(target: AdminUser) {
    const password = window.prompt(`New temporary password for ${target.name} (8+ characters):`)
    if (password) updateUser(target, { password }, `Password reset for ${target.name}. Their other sessions were signed out.`)
  }

  return <section className="hub-create hub-account-panel">
    <div className="hub-section-heading"><div><span className="hub-eyebrow">TEAM & SECURITY</span><h2>Signed in as {user.name}</h2></div><button type="button" className="hub-icon-button" onClick={onClose}>Close</button></div>
    <div className="hub-entry-filters" role="tablist" aria-label="Account sections">
      {user.role === 'owner' && <button type="button" role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}><Users size={13} /> Organizers</button>}
      <button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}><History size={13} /> Activity</button>
      <button type="button" role="tab" aria-selected={tab === 'me'} className={tab === 'me' ? 'active' : ''} onClick={() => setTab('me')}><KeyRound size={13} /> My password</button>
    </div>
    {notice && <p className="hub-account-notice">{notice}</p>}
    {error && <div className="hub-error">{error}</div>}

    {tab === 'me' && <form className="hub-entry-edit" onSubmit={changePassword}>
      <label>Current password<input type="password" autoComplete="current-password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} required /></label>
      <label>New password<input type="password" autoComplete="new-password" minLength={8} value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} required /></label>
      <label>Repeat new password<input type="password" autoComplete="new-password" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} required /></label>
      <div><button type="submit" disabled={busy}>Change password</button></div>
    </form>}

    {tab === 'team' && <>
      <div className="hub-user-list">{users.map((item) => <article className={`hub-user ${item.disabled ? 'disabled' : ''}`} key={item.id}>
        <div><strong>{item.name}{item.id === user.id ? ' (you)' : ''}</strong><small>@{item.username} · {item.role} · last sign-in {when(item.lastLoginAt)}</small></div>
        {item.id !== user.id && <div className="hub-user-actions">
          <button type="button" disabled={busy} onClick={() => resetPassword(item)}>Reset password</button>
          <button type="button" disabled={busy} onClick={() => updateUser(item, { role: item.role === 'owner' ? 'organizer' : 'owner' }, `${item.name} is now ${item.role === 'owner' ? 'an organizer' : 'an owner'}.`)}>{item.role === 'owner' ? 'Make organizer' : 'Make owner'}</button>
          <button type="button" className={item.disabled ? '' : 'danger'} disabled={busy} onClick={() => updateUser(item, { disabled: !item.disabled }, `${item.name} ${item.disabled ? 'enabled' : 'disabled and signed out'}.`)}>{item.disabled ? 'Enable' : 'Disable'}</button>
        </div>}
      </article>)}</div>
      <form className="hub-entry-edit" onSubmit={addOrganizer}>
        <label>Name<input maxLength={60} value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} required /></label>
        <label>Username<input maxLength={32} autoCapitalize="none" value={invite.username} onChange={(event) => setInvite({ ...invite, username: event.target.value })} required /></label>
        <label>Temporary password<input type="text" minLength={8} autoComplete="off" value={invite.password} onChange={(event) => setInvite({ ...invite, password: event.target.value })} required /></label>
        <label>Role<select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}><option value="organizer">Organizer (runs categories)</option><option value="owner">Owner (also manages accounts)</option></select></label>
        <div><button type="submit" disabled={busy}><UserPlus size={15} /> Add organizer</button></div>
      </form>
    </>}

    {tab === 'activity' && <ol className="hub-activity">{activity === null ? <li>Loading activity...</li> : activity.length ? activity.map((item, index) => <li key={index}>
      <time>{when(item.at)}</time><strong>{item.by}</strong><span>{item.action}{item.category ? ` · ${item.category}` : ''}{item.detail ? ` · ${item.detail}` : ''}</span>
    </li>) : <li>No activity yet.</li>}</ol>}
  </section>
}
