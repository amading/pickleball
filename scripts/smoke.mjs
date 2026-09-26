const base = process.env.SMOKE_URL || 'http://127.0.0.1:8791/api'
const pin = process.env.SMOKE_PIN || 'test-pin-6742'
const owner = { username: 'smoke-owner', password: 'smoke-password-1' }
let token = ''
// 1x1 transparent PNG: the server checks real image bytes, not just the data URL prefix.
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const fakePhoto = `data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`

async function request(path, method = 'GET', value, admin = false, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: value ? JSON.stringify(value) : undefined,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`${method} ${path}: ${result.error}`)
  return result
}

async function expectFail(path, method, value, text, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: value ? JSON.stringify(value) : undefined,
  })
  const result = await response.json()
  if (response.ok || !String(result.error || '').includes(text)) throw new Error(`Expected ${method} ${path} to fail with "${text}".`)
}

function assertNoTokens(value, label) {
  if (JSON.stringify(value).includes('scoreToken')) throw new Error(`${label} leaked score tokens.`)
}

async function scoreFinal(categoryId, match, winnerIndex = 1) {
  await expectFail(`/categories/${categoryId}/matches/${match.id}/score`, 'PATCH', { score1: 1, score2: 0, status: 'live', version: match.version }, 'Scan')
  let updated = await request(`/categories/${categoryId}/matches/${match.id}/score`, 'PATCH', {
    score1: winnerIndex === 1 ? 1 : 0,
    score2: winnerIndex === 2 ? 1 : 0,
    status: 'live',
    version: match.version,
  }, false, { 'x-score-token': match.scoreToken })
  updated = await request(`/categories/${categoryId}/matches/${match.id}/score`, 'PATCH', {
    score1: winnerIndex === 1 ? 3 : 0,
    score2: winnerIndex === 2 ? 3 : 0,
    status: 'final',
    version: updated.version,
  }, false, { 'x-score-token': match.scoreToken })
  if (updated.status !== 'final' || !updated.winner) throw new Error('Final scoring did not save a winner.')
  return updated
}

// Accounts: the setup PIN creates the first owner (or we sign in on a reused data file).
const setupStatus = await request('/admin/status')
const session = setupStatus.needsSetup
  ? await request('/admin/setup', 'POST', { pin, name: 'Smoke Owner', ...owner })
  : await request('/admin/login', 'POST', owner)
token = session.token
await expectFail('/admin/login', 'POST', { username: owner.username, password: 'wrong-password' }, 'Wrong username or password')
const pinOnly = await fetch(`${base}/admin/categories`, { headers: { 'x-admin-pin': pin } })
if (pinOnly.status !== 401) throw new Error('The setup PIN must not work as a login.')
const helperName = `helper-${Date.now()}`
const helper = await request('/admin/users', 'POST', { name: 'Court Helper', username: helperName, password: 'helper-pass-1' }, true)
const helperSession = await request('/admin/login', 'POST', { username: helperName, password: 'helper-pass-1' })
await expectFail('/admin/users', 'GET', undefined, 'Only the owner', { Authorization: `Bearer ${helperSession.token}` })
await request(`/admin/users/${helper.id}`, 'PATCH', { disabled: true }, true)
await expectFail('/admin/categories', 'GET', undefined, 'Organizer login', { Authorization: `Bearer ${helperSession.token}` })

const category = await request('/categories', 'POST', {
  title: 'Smoke Mixed Doubles',
  division: 'Newbie',
  format: 'mixed-doubles',
  eligibility: 'open',
  fee: 700,
  capacity: 10,
  poolSize: 5,
  courts: 1,
  pointsToWin: 3,
  winBy: 1,
  winsToQualify: 1,
  rules: 'Round robin.',
}, true)

await expectFail(`/categories/${category.id}/register`, 'POST', {
  teamName: 'Fake Photo', contact: '0917 000 0000', players: [{ name: 'A', gender: 'man', photo: fakePhoto }, { name: 'B', gender: 'woman', photo: fakePhoto }],
}, 'not a valid')

const entries = []
for (let index = 1; index <= 5; index += 1) {
  const team = await request(`/categories/${category.id}/register`, 'POST', {
    teamName: `Team ${index}`,
    contact: `0917 000 000${index}`, paymentRef: `GCASH-${index}`,
    players: [{ name: `Man ${index}`, gender: 'man', photo }, { name: `Woman ${index}`, gender: 'woman', photo }],
  })
  entries.push(team)
  if (index === 1) await expectFail(`/categories/${category.id}/registrations/${team.id}`, 'PATCH', { status: 'approved' }, 'Organizer login')
  await request(`/categories/${category.id}/registrations/${team.id}`, 'PATCH', { paid: true, status: 'approved' }, true)
}

// Payment is required when there is a fee; an unpaid entry cannot be approved.
const unpaid = await request(`/categories/${category.id}/register`, 'POST', {
  teamName: 'Unpaid Team', contact: '0917 111 2222',
  players: [{ name: 'Man X', gender: 'man', photo }, { name: 'Woman X', gender: 'woman', photo }],
})
const unpaidResponse = await fetch(`${base}/categories/${category.id}/registrations/${unpaid.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ status: 'approved' }) })
if (unpaidResponse.ok) throw new Error('Unpaid entry was approved.')
await request(`/categories/${category.id}/registrations/${unpaid.id}`, 'PATCH', { status: 'rejected' }, true)

// Photos are served as separate cached files, never inlined in category JSON.
const listed = await request(`/categories/${category.id}`)
if (JSON.stringify(listed).includes('data:image')) throw new Error('Category response still inlines photo data.')
const adminList = await request('/admin/categories', 'GET', undefined, true)
const firstEntry = adminList.find((item) => item.id === category.id).registrations[0]
if (firstEntry.contact !== '0917 000 0001' || !firstEntry.paid) throw new Error('Contact or payment was not saved.')
if (JSON.stringify(listed).includes('0917 000 0001')) throw new Error('Contact number leaked to the public category.')
const photoResponse = await fetch(base.replace(/\/api$/, '') + firstEntry.players[0].photo)
if (!photoResponse.ok || photoResponse.headers.get('content-type') !== 'image/png') throw new Error('Photo file is not served.')

// Unchanged data answers 304 so polling phones download nothing new.
const first = await fetch(`${base}/categories/${category.id}`)
const again = await fetch(`${base}/categories/${category.id}`, { headers: { 'If-None-Match': first.headers.get('etag') } })
if (again.status !== 304) throw new Error('Expected 304 for unchanged category.')

// Settings can be edited, and a draw with no scores can be undone.
await request(`/categories/${category.id}`, 'PATCH', { title: 'Smoke Mixed Doubles Edited', rules: 'Round robin, then playoffs.' }, true)
await request(`/categories/${category.id}/draw`, 'POST', undefined, true)
await request(`/categories/${category.id}/draw`, 'DELETE', undefined, true)
await request(`/categories/${category.id}/registrations/${firstEntry.id}`, 'PATCH', { teamName: 'Team One Renamed' }, true)

const csv = await fetch(`${base}/categories/${category.id}/export?kind=registrations`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.text())
if (!csv.includes('Team One Renamed') || !csv.includes('GCASH-1')) throw new Error('Registration CSV is missing data.')

const drawn = await request(`/categories/${category.id}/draw`, 'POST', undefined, true)
if (drawn.draw.pools.length !== 1 || drawn.draw.matches.length !== 10) throw new Error('Expected one pool with ten unique matches.')
const pairs = new Set(drawn.draw.matches.map((match) => [match.team1, match.team2].sort().join('::')))
if (pairs.size !== 10) throw new Error('Duplicate matches in round robin draw.')
if (!drawn.draw.pools[0].teams.some((team) => team.teamName === 'Team One Renamed')) throw new Error('Renamed team missing from the draw.')

const status = await request(`/categories/${category.id}/registration/${entries[0].id}`)
if (status.pool !== 'Pool A' || status.matches.length !== 4) throw new Error('Player assignment is incorrect.')
assertNoTokens(status, 'Registration status')

const publicCategory = await request(`/categories/${category.id}`)
if (publicCategory.registrations) throw new Error('Private registration list leaked to public endpoint.')
assertNoTokens(publicCategory, 'Public category')

// Private board: games are hidden until a team code unlocks them on at most one phone per player.
if (!publicCategory.locked || publicCategory.draw) throw new Error('Private board leaked the draw without a team code.')
if (!status.accessCode) throw new Error('Approved team has no code on its entry page.')
const unlocked = async (token) => request(`/categories/${category.id}`, 'GET', undefined, false, { 'x-player-token': token })
const phone1 = await request(`/categories/${category.id}/access`, 'POST', { code: status.accessCode.toLowerCase().replace('-', ' ') })
const phone2 = await request(`/categories/${category.id}/access`, 'POST', { code: status.accessCode })
await expectFail(`/categories/${category.id}/access`, 'POST', { code: status.accessCode }, 'already in use on 2 phones')
await expectFail(`/categories/${category.id}/access`, 'POST', { code: 'ZZZ-ZZZ' }, 'does not match')
const asPlayer = await unlocked(phone1.token)
if (asPlayer.locked || !asPlayer.draw || asPlayer.viewer?.teamId !== entries[0].id) throw new Error('Team code did not unlock the board for that team.')
assertNoTokens(asPlayer, 'Player board')
const hiddenMatch = drawn.draw.matches[0]
await expectFail(`/categories/${category.id}/matches/${hiddenMatch.id}`, 'GET', undefined, 'private')
await request(`/categories/${category.id}/matches/${hiddenMatch.id}`, 'GET', undefined, false, { 'x-player-token': phone2.token })
await request(`/categories/${category.id}/access`, 'DELETE', undefined, false, { 'x-player-token': phone2.token })
if (!(await unlocked(phone2.token)).locked) throw new Error('Signing out a phone did not remove its access.')
await request(`/categories/${category.id}/registrations/${entries[0].id}/reset-code`, 'POST', undefined, true)
if (!(await unlocked(phone1.token)).locked) throw new Error('Resetting the code did not sign phones out.')
const newCode = (await request(`/categories/${category.id}/registration/${entries[0].id}`)).accessCode
if (!newCode || newCode === status.accessCode) throw new Error('Reset did not issue a new code.')
const phone3 = await request(`/categories/${category.id}/access`, 'POST', { code: newCode })
await request(`/categories/${category.id}/end`, 'POST', { ended: true }, true)
if (!(await unlocked(phone3.token)).locked) throw new Error('Ending the event did not expire team access.')
await expectFail(`/categories/${category.id}/access`, 'POST', { code: newCode }, 'has ended')
if ((await request(`/categories/${category.id}/registration/${entries[0].id}`)).accessCode) throw new Error('Expired code still shown.')
await request(`/categories/${category.id}/end`, 'POST', { ended: false }, true)

let adminCategories = await request('/admin/categories', 'GET', undefined, true)
let adminCategory = adminCategories.find((item) => item.id === category.id)
if (!adminCategory.draw.matches.every((match) => match.scoreToken)) throw new Error('Organizer view is missing score tokens.')

const firstMatch = adminCategory.draw.matches[0]
await expectFail(`/categories/${category.id}/draw`, 'DELETE', undefined, 'Organizer login')
await expectFail(`/categories/${category.id}/matches/${firstMatch.id}/score`, 'PATCH', { score1: 5, score2: 1, status: 'final', version: firstMatch.version }, 'valid final', { 'x-score-token': firstMatch.scoreToken })

for (const [index, match] of adminCategory.draw.matches.entries()) {
  await scoreFinal(category.id, match, index % 3 === 0 ? 2 : 1)
}

adminCategories = await request('/admin/categories', 'GET', undefined, true)
adminCategory = adminCategories.find((item) => item.id === category.id)
if (adminCategory.draw.matches.some((match) => match.status !== 'final')) throw new Error('Not all pool matches finalized.')
if (!adminCategory.standings?.[0]?.teams.some((team) => team.wins > 0)) throw new Error('Standings did not compute wins.')
if ((adminCategory.qualified?.length || 0) < 2) throw new Error('Expected at least two bracket qualifiers.')

let playoff = await request(`/categories/${category.id}/playoff`, 'POST', undefined, true)
if (!playoff.playoff?.rounds?.length) throw new Error('Playoff bracket was not created.')
assertNoTokens(playoff, 'Public playoff response')

adminCategories = await request('/admin/categories', 'GET', undefined, true)
adminCategory = adminCategories.find((item) => item.id === category.id)
let livePlayoff = adminCategory.playoff.rounds.flatMap((round) => round.matches).find((match) => match.status !== 'bye' && match.team1 && match.team2)
if (!livePlayoff) throw new Error('Expected a scorable playoff match.')
await scoreFinal(category.id, livePlayoff, 1)

adminCategories = await request('/admin/categories', 'GET', undefined, true)
adminCategory = adminCategories.find((item) => item.id === category.id)
const finalMatch = adminCategory.playoff.rounds.at(-1).matches[0]
if (!finalMatch.team1 && !finalMatch.team2) throw new Error('Playoff advancement did not fill later bracket slots.')

const activity = await request('/admin/activity', 'GET', undefined, true)
if (!activity.some((item) => item.action === 'Published the random draw' && item.by === 'Smoke Owner')) throw new Error('Activity log is missing the draw.')
if (!activity.some((item) => item.action === 'Final score' && item.by === 'Court QR')) throw new Error('Activity log is missing QR final scores.')

const results = await fetch(`${base}/categories/${category.id}/export?kind=standings`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.text())
if (!results.includes('Pool A')) throw new Error('Standings CSV is missing data.')
await request(`/categories/${category.id}`, 'DELETE', undefined, true)
await expectFail(`/categories/${category.id}`, 'GET', undefined, 'not found')

console.log('Smoke passed: registration, secure draw, QR scoring, standings, qualifiers, playoff advancement, score validation, photo files, payment, contact privacy, 304 caching, edits, undo draw, CSV export, delete, organizer accounts, activity log, private boards, team codes, phone limits, code reset, and end of event.')
