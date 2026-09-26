const base = process.env.SMOKE_URL || 'http://127.0.0.1:8791/api'
const pin = process.env.SMOKE_PIN || 'test-pin-6742'
const photo = `data:image/png;base64,${Buffer.from('test').toString('base64')}`

async function request(path, method = 'GET', value, admin = false, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-admin-pin': pin } : {}), ...extraHeaders },
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

const entries = []
for (let index = 1; index <= 5; index += 1) {
  const team = await request(`/categories/${category.id}/register`, 'POST', {
    teamName: `Team ${index}`,
    players: [{ name: `Man ${index}`, gender: 'man', photo }, { name: `Woman ${index}`, gender: 'woman', photo }],
  })
  entries.push(team)
  await request(`/categories/${category.id}/registrations/${team.id}`, 'PATCH', { status: 'approved' }, true)
}

const drawn = await request(`/categories/${category.id}/draw`, 'POST', undefined, true)
if (drawn.draw.pools.length !== 1 || drawn.draw.matches.length !== 10) throw new Error('Expected one pool with ten unique matches.')
const pairs = new Set(drawn.draw.matches.map((match) => [match.team1, match.team2].sort().join('::')))
if (pairs.size !== 10) throw new Error('Duplicate matches in round robin draw.')

const status = await request(`/categories/${category.id}/registration/${entries[0].id}`)
if (status.pool !== 'Pool A' || status.matches.length !== 4) throw new Error('Player assignment is incorrect.')
assertNoTokens(status, 'Registration status')

const publicCategory = await request(`/categories/${category.id}`)
if (publicCategory.registrations) throw new Error('Private registration list leaked to public endpoint.')
assertNoTokens(publicCategory, 'Public category')

let adminCategories = await request('/admin/categories', 'GET', undefined, true)
let adminCategory = adminCategories.find((item) => item.id === category.id)
if (!adminCategory.draw.matches.every((match) => match.scoreToken)) throw new Error('Organizer view is missing score tokens.')

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

console.log('Smoke passed: registration, secure draw, QR scoring, standings, qualifiers, and playoff advancement.')
