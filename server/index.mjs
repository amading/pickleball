import http from 'node:http'
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { homedir, networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const dataFile = process.env.DATA_FILE || join(homedir(), '.rally-hq', 'data.json')
const port = Number(process.env.API_PORT || 8787)
const adminPin = process.env.ADMIN_PIN || String(randomInt(100000, 1000000))
const lanAddress = Object.values(networkInterfaces()).flat().find((item) => item && item.family === 'IPv4' && !item.internal)?.address
// In dev (scripts/dev.mjs) phones reach Vite on 5173; with `npm start` this server also serves the built site.
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const servesSite = !process.env.RALLY_DEV
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${lanAddress || '127.0.0.1'}:${servesSite ? port : 5173}`
const allowedImages = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/
const imageSignatures = {
  jpeg: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  png: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (bytes) => bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP',
}
const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' }
const failedLogins = new Map()
let database = { categories: [] }
let saving = Promise.resolve()

try {
  database = JSON.parse(await readFile(dataFile, 'utf8'))
  if (!Array.isArray(database.categories)) database = { categories: [] }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

function save() {
  const snapshot = JSON.stringify(database, null, 2)
  saving = saving.then(async () => {
    await mkdir(dirname(dataFile), { recursive: true })
    const temporary = `${dataFile}.tmp`
    await writeFile(temporary, snapshot)
    await rename(temporary, dataFile)
  })
  return saving
}

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function body(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 3_000_000) throw new Error('Photos are too large. Use images under 1 MB each.')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('Invalid form data.')
  }
}

function requiredText(value, label, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label} is required (maximum ${max} characters).`)
  return value.trim()
}

function image(value) {
  const match = typeof value === 'string' && value.length <= 1_400_000 ? allowedImages.exec(value) : null
  if (!match) throw new Error('Upload a JPG, PNG, or WebP photo under 1 MB.')
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
  if (bytes.length < 12 || !imageSignatures[match[1]](bytes)) throw new Error('That file is not a valid JPG, PNG, or WebP photo.')
  return value
}

function sameSecret(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function clientKey(req) {
  return req.socket.remoteAddress || 'unknown'
}

function loginLocked(req) {
  return (failedLogins.get(clientKey(req))?.until ?? 0) > Date.now()
}

function authorized(req) {
  if (typeof req.headers['x-admin-pin'] !== 'string' || loginLocked(req)) return false
  const key = clientKey(req)
  if (sameSecret(req.headers['x-admin-pin'], adminPin)) { failedLogins.delete(key); return true }
  // Five wrong PINs lock this address out, doubling from two minutes on each further miss.
  const count = (failedLogins.get(key)?.count ?? 0) + 1
  failedLogins.set(key, { count, until: count >= 5 ? Date.now() + 120_000 * 2 ** Math.min(count - 5, 5) : 0 })
  return false
}

function validFinal(first, second, pointsToWin, winBy) {
  const high = Math.max(first, second)
  const margin = Math.abs(first - second)
  // Past the target a game only continues until someone leads by exactly winBy (e.g. 13-11, never 15-2).
  return high >= pointsToWin && margin >= winBy && (high === pointsToWin || margin === winBy)
}

function activeEntries(category) {
  return category.registrations.filter((item) => item.status !== 'rejected').length
}

function publicMatch(match) {
  const visible = { ...match }
  delete visible.scoreToken
  return visible
}

function matchRecord(base) {
  return { ...base, score1: 0, score2: 0, status: 'scheduled', winner: null, version: 0, scoreToken: randomBytes(24).toString('base64url') }
}

function allMatches(category) {
  return [...(category.draw?.matches || []), ...(category.playoff?.rounds.flatMap((round) => round.matches) || [])]
}

function standings(category) {
  if (!category.draw) return []
  return category.draw.pools.map((pool) => {
    const rows = pool.teams.map((team) => ({ id: team.id, teamName: team.teamName, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }))
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const match of category.draw.matches.filter((item) => item.pool === pool.name && item.status === 'final')) {
      const first = byId.get(match.team1)
      const second = byId.get(match.team2)
      if (!first || !second) continue
      first.pointsFor += match.score1; first.pointsAgainst += match.score2
      second.pointsFor += match.score2; second.pointsAgainst += match.score1
      if (match.winner === first.id) { first.wins += 1; second.losses += 1 }
      else if (match.winner === second.id) { second.wins += 1; first.losses += 1 }
    }
    return { name: pool.name, teams: rows.sort((a, b) => b.wins - a.wins || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst) || a.teamName.localeCompare(b.teamName)) }
  })
}

function qualifiedTeams(category) {
  const minimum = category.winsToQualify ?? 3
  return standings(category).flatMap((pool) => pool.teams.filter((team) => team.wins >= minimum).map((team) => ({ ...team, pool: pool.name })))
}

function publicCategory(category) {
  return {
    id: category.id, title: category.title, division: category.division,
    format: category.format, eligibility: category.eligibility,
    fee: category.fee, capacity: category.capacity, poolSize: category.poolSize,
    courts: category.courts, rules: category.rules, published: category.published,
    pointsToWin: category.pointsToWin ?? 11, winBy: category.winBy ?? 2,
    winsToQualify: category.winsToQualify ?? 3,
    approvedCount: category.registrations.filter((item) => item.status === 'approved').length,
    draw: category.draw ? { pools: category.draw.pools, matches: category.draw.matches.map(publicMatch), publishedAt: category.draw.publishedAt } : null,
    standings: standings(category), qualified: qualifiedTeams(category),
    playoff: category.playoff ? { publishedAt: category.playoff.publishedAt, rounds: category.playoff.rounds.map((round) => ({ name: round.name, matches: round.matches.map(publicMatch) })) } : null,
  }
}

function shuffle(items) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1)
    ;[copy[index], copy[other]] = [copy[other], copy[index]]
  }
  return copy
}

function roundRobinPairs(teams) {
  const ring = teams.length % 2 ? [...teams, null] : [...teams]
  const pairs = []
  for (let round = 0; round < ring.length - 1; round += 1) {
    for (let index = 0; index < ring.length / 2; index += 1) {
      const first = ring[index]
      const second = ring[ring.length - 1 - index]
      if (first && second) pairs.push([first, second])
    }
    ring.splice(1, 0, ring.pop())
  }
  return pairs
}

function createDraw(category) {
  const teams = shuffle(category.registrations.filter((item) => item.status === 'approved'))
  if (teams.length < 2) throw new Error('Approve at least two teams before publishing a draw.')
  const poolCount = Math.max(1, Math.ceil(teams.length / category.poolSize))
  const pools = Array.from({ length: poolCount }, (_, index) => ({
    name: `Pool ${String.fromCharCode(65 + index)}`,
    court: `Court ${(index % category.courts) + 1}`,
    teams: [],
  }))
  teams.forEach((team, index) => {
    const pool = pools[index % poolCount]
    pool.teams.push({ id: team.id, teamName: team.teamName, players: team.players })
  })
  const rounds = pools.map((pool) => roundRobinPairs(pool.teams).map(([first, second]) => matchRecord({ id: randomUUID(), stage: 'pool', pool: pool.name, court: pool.court, team1: first.id, team2: second.id })))
  const matches = []
  for (let slot = 0; slot < Math.max(...rounds.map((round) => round.length)); slot += 1) {
    rounds.forEach((round) => { if (round[slot]) matches.push({ ...round[slot], game: matches.length + 1 }) })
  }
  return { pools, matches, publishedAt: new Date().toISOString() }
}

function createPlayoff(category) {
  if (!category.draw) throw new Error('Publish the pool draw first.')
  if (category.draw.matches.some((match) => match.status !== 'final')) throw new Error('Finish every pool match before creating the bracket.')
  const entrants = shuffle(qualifiedTeams(category))
  if (entrants.length < 2) throw new Error('At least two teams must reach the minimum wins.')
  const bracketSize = 2 ** Math.ceil(Math.log2(entrants.length))
  const firstRoundPairs = entrants.length - bracketSize / 2
  const slots = []
  let cursor = 0
  for (let index = 0; index < bracketSize / 2; index += 1) {
    slots.push(entrants[cursor++].id)
    slots.push(index < firstRoundPairs ? entrants[cursor++].id : null)
  }
  const rounds = []
  let prior = []
  for (let roundIndex = 0; 2 ** roundIndex < bracketSize; roundIndex += 1) {
    const matchCount = bracketSize / 2 ** (roundIndex + 1)
    const matches = Array.from({ length: matchCount }, (_, index) => {
      const first = roundIndex === 0 ? slots[index * 2] : null
      const second = roundIndex === 0 ? slots[index * 2 + 1] : null
      const match = matchRecord({
        id: randomUUID(), stage: 'playoff', round: roundIndex + 1,
        court: `Court ${(index % category.courts) + 1}`,
        team1: first, team2: second,
        source1: roundIndex === 0 ? null : prior[index * 2].id,
        source2: roundIndex === 0 ? null : prior[index * 2 + 1].id,
      })
      if (first && !second) { match.status = 'bye'; match.winner = first }
      return match
    })
    rounds.push({ name: matchCount === 1 ? 'Final' : matchCount === 2 ? 'Semifinals' : matchCount === 4 ? 'Quarterfinals' : `Round ${roundIndex + 1}`, matches })
    prior = matches
  }
  advancePlayoff(rounds)
  return { rounds, publishedAt: new Date().toISOString() }
}

function dependentMatch(rounds, match) {
  return rounds.flatMap((round) => round.matches).find((item) => item.source1 === match.id || item.source2 === match.id)
}

function advancePlayoff(rounds) {
  const byId = new Map(rounds.flatMap((round) => round.matches.map((match) => [match.id, match])))
  for (const round of rounds.slice(1)) {
    for (const match of round.matches) {
      const first = byId.get(match.source1)?.winner || null
      const second = byId.get(match.source2)?.winner || null
      if (match.team1 !== first || match.team2 !== second) {
        match.team1 = first; match.team2 = second
        match.score1 = 0; match.score2 = 0; match.status = 'scheduled'; match.winner = null; match.version += 1
      }
    }
  }
}

let migrated = false
for (const category of database.categories) {
  if (!category.winsToQualify) { category.winsToQualify = Math.min(3, category.poolSize - 1); migrated = true }
  if (!category.pointsToWin) { category.pointsToWin = 11; migrated = true }
  if (!category.winBy) { category.winBy = 2; migrated = true }
  if (category.playoff === undefined) { category.playoff = null; migrated = true }
  for (const match of allMatches(category)) {
    if (!match.scoreToken) { match.scoreToken = randomBytes(24).toString('base64url'); migrated = true }
    if (match.score1 === undefined) { match.score1 = 0; migrated = true }
    if (match.score2 === undefined) { match.score2 = 0; migrated = true }
    if (!match.status) { match.status = 'scheduled'; migrated = true }
    if (match.winner === undefined) { match.winner = null; migrated = true }
    if (match.version === undefined) { match.version = 0; migrated = true }
    if (!match.stage) { match.stage = 'pool'; migrated = true }
  }
}
if (migrated) await save()

async function serveSite(req, res, pathname) {
  if (!servesSite || !['GET', 'HEAD'].includes(req.method)) return send(res, 404, { error: 'Not found' })
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return send(res, 400, { error: 'Bad address.' }) }
  let file = resolve(distDir, '.' + normalize(decoded))
  if (file !== distDir && !file.startsWith(distDir + sep)) return send(res, 404, { error: 'Not found' })
  try { if (!(await stat(file)).isFile()) throw new Error('Not a file') } catch { file = join(distDir, 'index.html') }
  try {
    const content = await readFile(file)
    const hashed = file.includes(`${sep}assets${sep}`)
    res.writeHead(200, { 'Content-Type': staticTypes[extname(file)] || 'application/octet-stream', 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : content)
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Site not built yet. Run "npm run build" first, or use "npm run dev".')
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'api') return await serveSite(req, res, url.pathname)

    if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { publicBaseUrl })

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      if (authorized(req)) return send(res, 200, { ok: true })
      return send(res, loginLocked(req) ? 429 : 401, { error: loginLocked(req) ? 'Too many wrong PINs. Wait a few minutes and try again.' : 'Incorrect organizer PIN.' })
    }
    if (req.method === 'GET' && url.pathname === '/api/categories') {
      return send(res, 200, database.categories.filter((item) => item.published).map(publicCategory))
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/categories') {
      if (!authorized(req)) return send(res, 401, { error: 'Organizer login required.' })
      return send(res, 200, database.categories.map((category) => ({ ...category, standings: standings(category), qualified: qualifiedTeams(category) })))
    }
    if (req.method === 'POST' && url.pathname === '/api/categories') {
      if (!authorized(req)) return send(res, 401, { error: 'Organizer login required.' })
      const input = await body(req)
      const format = ['doubles', 'mixed-doubles', 'singles'].includes(input.format) ? input.format : null
      const eligibility = ['open', 'men', 'women', 'genderless'].includes(input.eligibility) ? input.eligibility : null
      const capacity = Number(input.capacity)
      const poolSize = Number(input.poolSize)
      const courts = Number(input.courts)
      const fee = Number(input.fee)
      const pointsToWin = Number(input.pointsToWin ?? 11)
      const winBy = Number(input.winBy ?? 2)
      const winsToQualify = Number(input.winsToQualify ?? Math.min(3, poolSize - 1))
      if (!format || !eligibility || !Number.isInteger(capacity) || capacity < 2 || capacity > 128 || !Number.isInteger(poolSize) || poolSize < 2 || poolSize > 12 || !Number.isInteger(courts) || courts < 1 || courts > 20 || !Number.isFinite(fee) || fee < 0 || !Number.isInteger(pointsToWin) || pointsToWin < 1 || pointsToWin > 99 || !Number.isInteger(winBy) || winBy < 1 || winBy > 5 || !Number.isInteger(winsToQualify) || winsToQualify < 1 || winsToQualify >= poolSize) throw new Error('Check category format, capacity, pool size, courts, scoring rules, and qualifying wins.')
      if (format === 'mixed-doubles' && eligibility !== 'open') throw new Error('Mixed doubles must use open eligibility.')
      const category = {
        id: randomUUID(), title: requiredText(input.title, 'Category name', 60), division: requiredText(input.division, 'Division', 40),
        format, eligibility, fee, capacity, poolSize, courts, pointsToWin, winBy, winsToQualify, rules: requiredText(input.rules, 'Rules', 500),
        published: true, createdAt: new Date().toISOString(), registrations: [], draw: null, playoff: null,
      }
      database.categories.unshift(category)
      await save()
      return send(res, 201, category)
    }
    if (parts.length >= 3 && parts[1] === 'categories') {
      const category = database.categories.find((item) => item.id === parts[2])
      if (!category) return send(res, 404, { error: 'Category not found.' })
      if (req.method === 'GET' && parts.length === 3) {
        if (!category.published) return send(res, 404, { error: 'Category not found.' })
        return send(res, 200, publicCategory(category))
      }
      if (req.method === 'DELETE' && parts.length === 3) {
        if (!authorized(req)) return send(res, 401, { error: 'Organizer login required.' })
        database.categories = database.categories.filter((item) => item.id !== category.id)
        await save()
        return send(res, 200, { ok: true })
      }
      if (req.method === 'PATCH' && parts[3] === 'qualification') {
        if (!authorized(req)) return send(res, 401, { error: 'Organizer login required.' })
        if (category.playoff) throw new Error('Qualification is locked after the playoff bracket is published.')
        const input = await body(req)
        const wins = Number(input.winsToQualify)
        if (!Number.isInteger(wins) || wins < 1 || wins >= category.poolSize) throw new Error(`Choose 1 to ${category.poolSize - 1} wins.`)
        category.winsToQualify = wins
        await save()
        return send(res, 200, publicCategory(category))
      }
      if (parts[3] === 'matches' && parts[4]) {
        const match = allMatches(category).find((item) => item.id === parts[4])
        if (!match) return send(res, 404, { error: 'Match not found.' })
        const teamById = new Map(category.registrations.map((item) => [item.id, { id: item.id, teamName: item.teamName, players: item.players }]))
        if (req.method === 'GET' && parts.length === 5) return send(res, 200, {
          categoryId: category.id, categoryTitle: category.title, pointsToWin: category.pointsToWin ?? 11,
          winBy: category.winBy ?? 2, match: publicMatch(match),
          team1: teamById.get(match.team1) || null, team2: teamById.get(match.team2) || null,
        })
        if (req.method === 'PATCH' && parts[5] === 'score') {
          const admin = authorized(req)
          const token = req.headers['x-score-token']
          if (!admin && !sameSecret(token, match.scoreToken)) return send(res, 403, { error: 'Scan the organizer QR code to score this match.' })
          if (match.status === 'bye') throw new Error('A bye advances automatically.')
          if (match.status === 'final' && !admin) throw new Error('Final score is locked. Ask the organizer to correct it.')
          if (match.stage === 'pool' && category.playoff) throw new Error('Pool scores are locked after the playoff bracket is published.')
          if (!match.team1 || !match.team2) throw new Error('Both opponents must be known before scoring.')
          const input = await body(req)
          const first = Number(input.score1)
          const second = Number(input.score2)
          if (Number(input.version) !== (match.version ?? 0)) return send(res, 409, { error: 'Score changed on another device. Refresh and try again.' })
          if (!Number.isInteger(first) || !Number.isInteger(second) || first < 0 || second < 0 || first > 999 || second > 999) throw new Error('Scores must be whole numbers from 0 to 999.')
          if (!['live', 'final'].includes(input.status)) throw new Error('Choose live or final score status.')
          if (input.status === 'final' && !validFinal(first, second, category.pointsToWin ?? 11, category.winBy ?? 2)) throw new Error(`Not a valid final: first to ${category.pointsToWin ?? 11}, win by ${category.winBy ?? 2} (past ${category.pointsToWin ?? 11} the lead must be exactly ${category.winBy ?? 2}).`)
          if (input.status !== 'final' && match.status === 'final' && match.stage === 'playoff') {
            const next = dependentMatch(category.playoff.rounds, match)
            if (next && ['live', 'final'].includes(next.status)) throw new Error('The next playoff match already started with this winner. Reopen that match first.')
          }
          match.score1 = first; match.score2 = second; match.status = input.status
          match.winner = input.status === 'final' ? first > second ? match.team1 : match.team2 : null
          match.version = (match.version ?? 0) + 1
          if (match.stage === 'playoff') advancePlayoff(category.playoff.rounds)
          await save()
          return send(res, 200, publicMatch(match))
        }
      }
      if (req.method === 'POST' && parts[3] === 'register') {
        if (!category.published || category.draw) throw new Error('Registration is closed for this category.')
        if (activeEntries(category) >= category.capacity) throw new Error('This category is full.')
        const input = await body(req)
        // Re-check after the upload finishes; other entries or the draw may have landed meanwhile.
        if (category.draw) throw new Error('Registration is closed for this category.')
        if (activeEntries(category) >= category.capacity) throw new Error('This category is full.')
        const players = Array.isArray(input.players) ? input.players : []
        const expected = category.format === 'singles' ? 1 : 2
        if (players.length !== expected) throw new Error(`This category needs ${expected} player${expected === 1 ? '' : 's'}.`)
        const cleaned = players.map((player, index) => ({
          name: requiredText(player.name, `Player ${index + 1} name`, 70),
          gender: ['man', 'woman', 'other'].includes(player.gender) ? player.gender : 'other',
          photo: image(player.photo),
        }))
        if (category.format === 'mixed-doubles' && !(cleaned.some((player) => player.gender === 'man') && cleaned.some((player) => player.gender === 'woman'))) throw new Error('Mixed doubles needs one man and one woman.')
        if (category.eligibility === 'men' && cleaned.some((player) => player.gender !== 'man')) throw new Error('This category is for men.')
        if (category.eligibility === 'women' && cleaned.some((player) => player.gender !== 'woman')) throw new Error('This category is for women.')
        const registration = { id: randomUUID(), teamName: requiredText(input.teamName, 'Team name', 70), players: cleaned, status: 'pending', createdAt: new Date().toISOString() }
        if (category.registrations.some((item) => item.status !== 'rejected' && item.teamName.toLowerCase() === registration.teamName.toLowerCase())) throw new Error('That team name is already registered in this category.')
        category.registrations.push(registration)
        await save()
        return send(res, 201, { id: registration.id, status: registration.status, teamName: registration.teamName })
      }
      if (req.method === 'GET' && parts[3] === 'registration' && parts[4]) {
        const registration = category.registrations.find((item) => item.id === parts[4])
        if (!registration) return send(res, 404, { error: 'Registration not found.' })
        const assignment = category.draw?.pools.find((pool) => pool.teams.some((team) => team.id === registration.id))
        return send(res, 200, { id: registration.id, teamName: registration.teamName, status: registration.status, pool: assignment?.name ?? null, court: assignment?.court ?? null, matches: category.draw?.matches.filter((match) => match.team1 === registration.id || match.team2 === registration.id).map(publicMatch) ?? [] })
      }
      if (req.method === 'PATCH' && parts[3] === 'registrations' && parts[4]) {
        if (!authorized(req)) return send(res, 401, { error: 'Organizer login required.' })
        if (category.draw) throw new Error('The draw is already published.')
        const registration = category.registrations.find((item) => item.id === parts[4])
        if (!registration) return send(res, 404, { error: 'Registration not found.' })
        const input = await body(req)
        if (!['approved', 'rejected', 'pending'].includes(input.status)) throw new Error('Invalid registration status.')
        if (registration.status === 'rejected' && input.status !== 'rejected' && activeEntries(category) >= category.capacity) throw new Error('All team slots are taken. Reject another entry first.')
        registration.status = input.status
        await save()
        return send(res, 200, registration)
      }
      if (req.method === 'POST' && parts[3] === 'draw') {
        if (!authorized(req)) return send(res, 401, { error: 'Organizer login required.' })
        if (category.draw) throw new Error('The draw is already published.')
        category.draw = createDraw(category)
        await save()
        return send(res, 200, publicCategory(category))
      }
      if (req.method === 'POST' && parts[3] === 'playoff') {
        if (!authorized(req)) return send(res, 401, { error: 'Organizer login required.' })
        if (category.playoff) throw new Error('Playoff bracket is already published.')
        category.playoff = createPlayoff(category)
        await save()
        return send(res, 200, publicCategory(category))
      }
    }
    return send(res, 404, { error: 'Not found' })
  } catch (error) {
    send(res, 400, { error: error.message || 'Request failed.' })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Rally HQ API listening on http://127.0.0.1:${port}`)
  console.log(`Player registration links use ${publicBaseUrl}`)
  if (servesSite) console.log(`Serving the built site from ${distDir}`)
  if (!process.env.ADMIN_PIN) console.log(`Organizer PIN for this run: ${adminPin} (set ADMIN_PIN for a stable PIN)`)
})
