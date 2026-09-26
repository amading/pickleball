import http from 'node:http'
import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { homedir, networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const dataFile = resolve(process.env.DATA_FILE || join(homedir(), '.rally-hq', 'data.json'))
const dataDir = dirname(dataFile)
const photoDir = join(dataDir, 'photos')
const backupDir = join(dataDir, 'backups')
const pinFile = join(dataDir, 'admin-pin.txt')
// Hosting platforms usually hand the port over as PORT.
const port = Number(process.env.API_PORT || process.env.PORT || 8787)
const trustProxy = process.env.TRUST_PROXY === '1'
const backupEveryMs = Number(process.env.BACKUP_MINUTES || 30) * 60_000
const backupsKept = Number(process.env.BACKUPS_KEPT || 48)
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
const imageExtensions = { jpeg: 'jpg', png: 'png', webp: 'webp' }
const photoIdPattern = /^[0-9a-f-]{36}\.(jpg|png|webp)$/
const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' }
const failedLogins = new Map()
const scryptAsync = promisify(scrypt)
const sessionDays = 14
let database = { categories: [] }
let saving = Promise.resolve()
let lastBackupAt = 0

await mkdir(photoDir, { recursive: true })
await mkdir(backupDir, { recursive: true })

// The setup/recovery PIN: ADMIN_PIN wins; otherwise one is generated once and kept next to the data.
// It creates the first owner account and resets forgotten passwords; day-to-day login uses accounts.
let adminPin = process.env.ADMIN_PIN
if (!adminPin) {
  try { adminPin = (await readFile(pinFile, 'utf8')).trim() } catch { /* first run */ }
  if (!adminPin) {
    adminPin = String(randomInt(100000, 1000000))
    await writeFile(pinFile, adminPin + '\n', { mode: 0o600 })
  }
}

try {
  database = JSON.parse(await readFile(dataFile, 'utf8'))
  if (!Array.isArray(database.categories)) database = { categories: [] }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
database.users ??= []
database.sessions ??= []
database.audit ??= []

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function pruneBackups() {
  const files = (await readdir(backupDir)).filter((name) => name.endsWith('.json')).sort()
  for (const name of files.slice(0, Math.max(0, files.length - backupsKept))) await unlink(join(backupDir, name)).catch(() => {})
}

/** Copies the saved data file into backups/. Photos are separate files and are never deleted, so ids stay valid. */
function backupNow(reason) {
  saving = saving.then(async () => {
    try { await copyFile(dataFile, join(backupDir, `data-${stamp()}-${reason}.json`)) } catch (error) { if (error.code !== 'ENOENT') throw error }
    lastBackupAt = Date.now()
    await pruneBackups()
  })
  return saving
}

function save() {
  const snapshot = JSON.stringify(database, null, 2)
  saving = saving.then(async () => {
    const temporary = `${dataFile}.tmp`
    await writeFile(temporary, snapshot)
    await rename(temporary, dataFile)
    if (Date.now() - lastBackupAt >= backupEveryMs) {
      await copyFile(dataFile, join(backupDir, `data-${stamp()}-auto.json`))
      lastBackupAt = Date.now()
      await pruneBackups()
    }
  })
  return saving
}

function send(res, status, value) {
  const text = JSON.stringify(value)
  const req = res.req
  // Unchanged GET responses become an empty 304, so phones polling every few seconds download almost nothing.
  if (status === 200 && req?.method === 'GET') {
    const etag = `"${createHash('sha1').update(text).digest('base64url')}"`
    res.setHeader('ETag', etag)
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'Cache-Control': 'private, no-cache' })
      return res.end()
    }
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-cache' })
  res.end(text)
}

function sendFile(res, status, content, type, filename) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${filename}"` })
  res.end(content)
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
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new Error('Invalid form data.')
  }
}

function requiredText(value, label, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label} is required (maximum ${max} characters).`)
  return value.trim()
}

function optionalText(value, label, max) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.trim().length > max) throw new Error(`${label} must be at most ${max} characters.`)
  return value.trim()
}

function contactNumber(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^[+0-9 ()-]{7,20}$/.test(text) || text.replace(/\D/g, '').length < 7) throw new Error('Enter a contact mobile number (e.g. 0917 123 4567).')
  return text
}

/** Checks a data-URL photo by its real bytes and returns what is needed to store it. */
function image(value) {
  const match = typeof value === 'string' && value.length <= 1_400_000 ? allowedImages.exec(value) : null
  if (!match) throw new Error('Upload a JPG, PNG, or WebP photo under 1 MB.')
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
  if (bytes.length < 12 || !imageSignatures[match[1]](bytes)) throw new Error('That file is not a valid JPG, PNG, or WebP photo.')
  return { bytes, extension: imageExtensions[match[1]] }
}

async function storePhoto({ bytes, extension }) {
  const id = `${randomUUID()}.${extension}`
  await writeFile(join(photoDir, id), bytes)
  return id
}

function wholeNumber(value, label, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`)
  return number
}

function sameSecret(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function clientKey(req) {
  const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : ''
  return forwarded || req.socket.remoteAddress || 'unknown'
}

function loginLocked(req) {
  return (failedLogins.get(clientKey(req))?.until ?? 0) > Date.now()
}

/** Five failed logins or PIN checks lock this address out, doubling from two minutes on each further miss. */
function noteFailure(req) {
  const key = clientKey(req)
  const count = (failedLogins.get(key)?.count ?? 0) + 1
  failedLogins.set(key, { count, until: count >= 5 ? Date.now() + 120_000 * 2 ** Math.min(count - 5, 5) : 0 })
}

function lockedError() {
  return new Error('Too many failed attempts. Wait a few minutes and try again.')
}

function checkPin(req, pin) {
  if (loginLocked(req)) throw lockedError()
  if (!sameSecret(pin, adminPin)) { noteFailure(req); throw new Error('Incorrect setup PIN. It is printed in the server terminal.') }
  failedLogins.delete(clientKey(req))
}

async function hashPassword(password) {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString('base64')}:${(await scryptAsync(password, salt, 64)).toString('base64')}`
}

async function passwordMatches(password, stored) {
  const [, salt, hash] = String(stored || 'scrypt:AAAA:AAAA').split(':')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), 64)
  const expected = Buffer.from(hash, 'base64')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function validUsername(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) throw new Error('Username: 3-32 letters, numbers, dots, dashes, or underscores.')
  return name
}

function validPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) throw new Error('Password must be at least 8 characters.')
  return value
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function publicUser(user) {
  return { id: user.id, username: user.username, name: user.name, role: user.role, disabled: Boolean(user.disabled), createdAt: user.createdAt, lastLoginAt: user.lastLoginAt ?? null }
}

/** The signed-in organizer for this request, from a Bearer session token, or null. */
function currentUser(req) {
  const header = String(req.headers.authorization || '')
  if (!header.startsWith('Bearer ')) return null
  const hash = tokenHash(header.slice(7).trim())
  const session = database.sessions.find((item) => item.tokenHash === hash && item.expiresAt > Date.now())
  const user = session && database.users.find((item) => item.id === session.userId)
  return user && !user.disabled ? user : null
}

function startSession(user) {
  const token = randomBytes(32).toString('base64url')
  database.sessions = database.sessions.filter((item) => item.expiresAt > Date.now())
  database.sessions.push({ tokenHash: tokenHash(token), userId: user.id, expiresAt: Date.now() + sessionDays * 86_400_000 })
  user.lastLoginAt = new Date().toISOString()
  return token
}

function audit(user, action, category, detail = '') {
  database.audit.unshift({ at: new Date().toISOString(), by: user ? user.name : 'Court QR', username: user?.username ?? null, action, category: category?.title ?? null, detail })
  database.audit.length = Math.min(database.audit.length, 1000)
}

function activeOwners() {
  return database.users.filter((item) => item.role === 'owner' && !item.disabled)
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

function photoUrl(photoId) {
  return photoId ? `/api/photos/${photoId}` : ''
}

/** Public face of a team: names and photo links only. Contact and payment details stay organizer-only. */
function teamView(registration) {
  return { id: registration.id, teamName: registration.teamName, players: registration.players.map((player) => ({ name: player.name, photo: photoUrl(player.photoId) })) }
}

function adminRegistration(registration) {
  const { devices, ...rest } = registration
  return { ...rest, devicesUsed: devices?.length ?? 0, players: registration.players.map((player) => ({ name: player.name, gender: player.gender, photo: photoUrl(player.photoId) })) }
}

// Team codes: easy to read aloud or text, no look-alike characters (0/O, 1/I/L).
const codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function newAccessCode() {
  const taken = new Set(database.categories.flatMap((item) => item.registrations.map((entry) => entry.accessCode)))
  for (;;) {
    const raw = Array.from({ length: 6 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('')
    const code = `${raw.slice(0, 3)}-${raw.slice(3)}`
    if (!taken.has(code)) return code
  }
}

function normalizeCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return raw.length === 6 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : ''
}

/** Phones a team code may unlock: one per player (2 for doubles, 1 for singles). */
function deviceLimit(registration) {
  return Math.max(1, registration.players.length)
}

/** The approved team whose player token is on this request, for a still-running event; otherwise null. */
function playerFor(req, category) {
  if (category.endedAt) return null
  const tokens = String(req.headers['x-player-token'] || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20)
  if (!tokens.length) return null
  const hashes = new Set(tokens.map(tokenHash))
  return category.registrations.find((entry) => entry.status === 'approved' && entry.devices?.some((device) => hashes.has(device.tokenHash))) ?? null
}

/** Organizers always see the board; on a private board, players need an unlocked team code. */
function canSeeBoard(req, category, user) {
  return Boolean(user) || !category.privateBoard || Boolean(playerFor(req, category))
}

function publicMatch(match) {
  const visible = { ...match }
  delete visible.scoreToken
  delete visible.scoreEvents
  delete visible.rallyHistory
  return visible
}

function matchRecord(base, format = 'doubles') {
  return { ...base, score1: 0, score2: 0, status: 'scheduled', winner: null, version: 0,
    serveTeam: 1, serveNumber: format === 'singles' ? 1 : 2, rallyHistory: [], scoreToken: randomBytes(24).toString('base64url') }
}

function allMatches(category) {
  return [...(category.draw?.matches || []), ...(category.playoff?.rounds.flatMap((round) => round.matches) || [])]
}

function drawPools(category) {
  const byId = new Map(category.registrations.map((item) => [item.id, item]))
  return category.draw.pools.map((pool) => ({ name: pool.name, court: pool.court, teams: pool.teams.map((team) => byId.get(team.id)).filter(Boolean).map(teamView) }))
}

/**
 * Pool table order: wins; then, among teams tied on wins, head-to-head wins between those teams;
 * then point difference; then points scored; then draw position (random from the secure shuffle).
 */
function standings(category) {
  if (!category.draw) return []
  const names = new Map(category.registrations.map((item) => [item.id, item.teamName]))
  return category.draw.pools.map((pool) => {
    const rows = pool.teams.map((team, seed) => ({ id: team.id, teamName: names.get(team.id) ?? 'Team', wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, seed }))
    const byId = new Map(rows.map((row) => [row.id, row]))
    const finals = category.draw.matches.filter((item) => item.pool === pool.name && item.status === 'final')
    for (const match of finals) {
      const first = byId.get(match.team1)
      const second = byId.get(match.team2)
      if (!first || !second) continue
      first.pointsFor += match.score1; first.pointsAgainst += match.score2
      second.pointsFor += match.score2; second.pointsAgainst += match.score1
      if (match.winner === first.id) { first.wins += 1; second.losses += 1 }
      else if (match.winner === second.id) { second.wins += 1; first.losses += 1 }
    }
    const headToHead = new Map()
    for (const row of rows) {
      const tied = new Set(rows.filter((other) => other.wins === row.wins).map((other) => other.id))
      headToHead.set(row.id, finals.filter((match) => match.winner === row.id && tied.has(match.team1) && tied.has(match.team2)).length)
    }
    const ordered = rows.sort((a, b) => b.wins - a.wins
      || headToHead.get(b.id) - headToHead.get(a.id)
      || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst)
      || b.pointsFor - a.pointsFor
      || a.seed - b.seed)
    return { name: pool.name, teams: ordered.map((row, index) => ({ id: row.id, teamName: row.teamName, wins: row.wins, losses: row.losses, pointsFor: row.pointsFor, pointsAgainst: row.pointsAgainst, rank: index + 1 })) }
  })
}

function qualifiedTeams(category) {
  const tables = standings(category)
  if (category.qualifyMode === 'top') {
    return tables.flatMap((pool) => pool.teams.slice(0, category.qualifyTop ?? 2).map((team) => ({ ...team, pool: pool.name })))
  }
  const minimum = category.winsToQualify ?? 3
  return tables.flatMap((pool) => pool.teams.filter((team) => team.wins >= minimum).map((team) => ({ ...team, pool: pool.name })))
}

function categorySettings(category) {
  return {
    id: category.id, title: category.title, division: category.division,
    format: category.format, eligibility: category.eligibility,
    fee: category.fee, capacity: category.capacity, poolSize: category.poolSize,
    courts: category.courts, rules: category.rules, published: category.published,
    pointsToWin: category.pointsToWin ?? 11, winBy: category.winBy ?? 2,
    winsToQualify: category.winsToQualify ?? 3, qualifyMode: category.qualifyMode ?? 'wins', qualifyTop: category.qualifyTop ?? 2,
    requirePayment: Boolean(category.requirePayment), privateBoard: Boolean(category.privateBoard),
    ended: Boolean(category.endedAt), endedAt: category.endedAt ?? null,
  }
}

function publicCategory(category, canSee = true) {
  const summary = {
    ...categorySettings(category),
    approvedCount: category.registrations.filter((item) => item.status === 'approved').length,
  }
  // A private board hides teams, games, and results from anyone without a team code.
  if (!canSee) return { ...summary, locked: true, drawPublished: Boolean(category.draw), draw: null, standings: [], qualified: [], playoff: null }
  return {
    ...summary,
    locked: false,
    draw: category.draw ? { pools: drawPools(category), matches: category.draw.matches.map(publicMatch), publishedAt: category.draw.publishedAt } : null,
    standings: standings(category), qualified: qualifiedTeams(category),
    playoff: category.playoff ? { publishedAt: category.playoff.publishedAt, seeded: Boolean(category.playoff.seeded), rounds: category.playoff.rounds.map((round) => ({ name: round.name, matches: round.matches.map(publicMatch) })) } : null,
  }
}

function adminCategory(category) {
  return {
    ...categorySettings(category), createdAt: category.createdAt, stationToken: category.stationToken,
    approvedCount: category.registrations.filter((item) => item.status === 'approved').length,
    registrations: category.registrations.map(adminRegistration),
    draw: category.draw ? { pools: drawPools(category), matches: category.draw.matches, publishedAt: category.draw.publishedAt } : null,
    standings: standings(category), qualified: qualifiedTeams(category),
    playoff: category.playoff,
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

/**
 * Orders pool games into waves of up to one game per court. A team never plays twice in a wave, teams
 * that just played get a rest when another game is available, and any free court takes the next game,
 * so no court sits idle while another pool still has games waiting.
 */
function scheduleWaves(pairsByPool, courts) {
  const remaining = []
  const longest = Math.max(...pairsByPool.map((pairs) => pairs.length))
  for (let slot = 0; slot < longest; slot += 1) pairsByPool.forEach((pairs) => { if (pairs[slot]) remaining.push(pairs[slot]) })
  const lastWave = new Map()
  const scheduled = []
  for (let wave = 1; remaining.length; wave += 1) {
    const busy = new Set()
    const picks = []
    const rested = (item) => lastWave.get(item.team1) !== wave - 1 && lastWave.get(item.team2) !== wave - 1
    for (const pass of [rested, () => true]) {
      for (const item of remaining) {
        if (picks.length === courts) break
        if (picks.includes(item) || busy.has(item.team1) || busy.has(item.team2) || !pass(item)) continue
        picks.push(item); busy.add(item.team1); busy.add(item.team2)
      }
    }
    picks.forEach((item, index) => {
      remaining.splice(remaining.indexOf(item), 1)
      lastWave.set(item.team1, wave); lastWave.set(item.team2, wave)
      scheduled.push({ ...item, wave, court: `Court ${index + 1}`, game: scheduled.length + 1 })
    })
  }
  return scheduled
}

function createDraw(category) {
  const teams = shuffle(category.registrations.filter((item) => item.status === 'approved'))
  if (teams.length < 2) throw new Error('Approve at least two teams before publishing a draw.')
  const poolCount = Math.max(1, Math.ceil(teams.length / category.poolSize))
  const courtLabel = category.courts === 1 ? 'Court 1' : `Courts 1-${category.courts}`
  const pools = Array.from({ length: poolCount }, (_, index) => ({ name: `Pool ${String.fromCharCode(65 + index)}`, court: courtLabel, teams: [] }))
  teams.forEach((team, index) => { pools[index % poolCount].teams.push({ id: team.id }) })
  const pairsByPool = pools.map((pool) => roundRobinPairs(pool.teams).map(([first, second]) => matchRecord({ id: randomUUID(), stage: 'pool', pool: pool.name, team1: first.id, team2: second.id }, category.format)))
  return { pools, matches: scheduleWaves(pairsByPool, category.courts), publishedAt: new Date().toISOString() }
}

/** Standard bracket order: seed 1 meets the lowest seed, and 1 and 2 can only meet in the final. */
function seedOrder(size) {
  let order = [1]
  while (order.length < size) order = order.flatMap((seed) => [seed, order.length * 2 + 1 - seed])
  return order
}

function seededSlots(entrants, bracketSize) {
  const ranked = [...shuffle(entrants)].sort((a, b) => a.rank - b.rank || b.wins - a.wins
    || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst) || b.pointsFor - a.pointsFor)
  const slots = seedOrder(bracketSize).map((seed) => ranked[seed - 1] ?? null)
  // Keep pool-mates apart in the opening round when a swap between lower seeds allows it.
  const pairs = Array.from({ length: bracketSize / 2 }, (_, index) => [slots[index * 2], slots[index * 2 + 1]])
  const clash = ([a, b]) => Boolean(a && b && a.pool === b.pool)
  for (const pair of pairs) {
    if (!clash(pair)) continue
    const partner = pairs.find((other) => other !== pair && other[1] && other[0]?.pool !== pair[1].pool && pair[0].pool !== other[1].pool)
    if (partner) [pair[1], partner[1]] = [partner[1], pair[1]]
  }
  return pairs.flat().map((team) => team?.id ?? null)
}

function randomSlots(entrants, bracketSize) {
  const shuffled = shuffle(entrants)
  const firstRoundPairs = shuffled.length - bracketSize / 2
  const slots = []
  let cursor = 0
  for (let index = 0; index < bracketSize / 2; index += 1) {
    slots.push(shuffled[cursor++].id)
    slots.push(index < firstRoundPairs ? shuffled[cursor++].id : null)
  }
  return slots
}

function createPlayoff(category) {
  if (!category.draw) throw new Error('Publish the pool draw first.')
  if (category.draw.matches.some((match) => match.status !== 'final')) throw new Error('Finish every pool match before creating the bracket.')
  const entrants = qualifiedTeams(category)
  if (entrants.length < 2) throw new Error('At least two teams must qualify for a bracket.')
  const bracketSize = 2 ** Math.ceil(Math.log2(entrants.length))
  const seeded = category.qualifyMode === 'top'
  const slots = seeded ? seededSlots(entrants, bracketSize) : randomSlots(entrants, bracketSize)
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
      }, category.format)
      if (first && !second) { match.status = 'bye'; match.winner = first }
      if (!first && second) { match.team1 = second; match.team2 = null; match.status = 'bye'; match.winner = second }
      return match
    })
    rounds.push({ name: matchCount === 1 ? 'Final' : matchCount === 2 ? 'Semifinals' : matchCount === 4 ? 'Quarterfinals' : `Round of ${matchCount * 2}`, matches })
    prior = matches
  }
  advancePlayoff(rounds, category.format)
  return { rounds, seeded, publishedAt: new Date().toISOString() }
}

function dependentMatch(rounds, match) {
  return rounds.flatMap((round) => round.matches).find((item) => item.source1 === match.id || item.source2 === match.id)
}

function advancePlayoff(rounds, format = 'doubles') {
  const byId = new Map(rounds.flatMap((round) => round.matches.map((match) => [match.id, match])))
  for (const round of rounds.slice(1)) {
    for (const match of round.matches) {
      const first = byId.get(match.source1)?.winner || null
      const second = byId.get(match.source2)?.winner || null
      if (match.team1 !== first || match.team2 !== second) {
        match.team1 = first; match.team2 = second
        match.score1 = 0; match.score2 = 0; match.status = 'scheduled'; match.winner = null
        match.serveTeam = 1; match.serveNumber = format === 'singles' ? 1 : 2
        match.rallyHistory = []; match.scoreEvents = []; match.version += 1
      }
    }
  }
}

function hasResults(category) {
  return allMatches(category).some((match) => match.status === 'live' || match.status === 'final')
}

function toCsv(rows) {
  // Prefix cells Excel would run as formulas.
  const cell = (value) => {
    let text = value === null || value === undefined ? '' : String(value)
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

function exportRows(category, kind) {
  const names = new Map(category.registrations.map((item) => [item.id, item.teamName]))
  if (kind === 'registrations') return [
    ['Team', 'Status', 'Paid', 'Payment reference', 'Contact', ...category.registrations[0]?.players.map((_, index) => `Player ${index + 1}`) ?? ['Player 1'], 'Registered at'],
    ...category.registrations.map((item) => [item.teamName, item.status, item.paid ? 'yes' : 'no', item.paymentRef, item.contact, ...item.players.map((player) => player.name), item.createdAt]),
  ]
  if (kind === 'standings') return [
    ['Pool', 'Rank', 'Team', 'Wins', 'Losses', 'Points for', 'Points against', 'Difference', 'Qualified'],
    ...standings(category).flatMap((pool) => {
      const qualified = new Set(qualifiedTeams(category).map((team) => team.id))
      return pool.teams.map((team) => [pool.name, team.rank, team.teamName, team.wins, team.losses, team.pointsFor, team.pointsAgainst, team.pointsFor - team.pointsAgainst, qualified.has(team.id) ? 'yes' : 'no'])
    }),
  ]
  return [
    ['Stage', 'Pool or round', 'Game', 'Court', 'Team 1', 'Team 2', 'Score 1', 'Score 2', 'Status', 'Winner'],
    ...(category.draw?.matches ?? []).map((match) => ['Pool', match.pool, match.game, match.court, names.get(match.team1), names.get(match.team2), match.score1, match.score2, match.status, names.get(match.winner) ?? '']),
    ...(category.playoff?.rounds ?? []).flatMap((round) => round.matches.map((match) => ['Playoff', round.name, '', match.court, names.get(match.team1) ?? 'TBD', names.get(match.team2) ?? (match.status === 'bye' ? 'BYE' : 'TBD'), match.score1, match.score2, match.status, names.get(match.winner) ?? ''])),
  ]
}

// ---- One-time upgrades of older data files ----
let migrated = false
let backedUp = false
async function beforeMigration() {
  if (backedUp) return
  backedUp = true
  await backupNow('before-upgrade')
}
const photoCache = new Map()
for (const category of database.categories) {
  if (!category.stationToken) { category.stationToken = randomBytes(24).toString('base64url'); migrated = true }
  for (const [key, value] of [['pointsToWin', 11], ['winBy', 2], ['qualifyMode', 'wins'], ['qualifyTop', 2], ['requirePayment', false], ['privateBoard', true], ['endedAt', null]]) {
    if (category[key] === undefined) { category[key] = value; migrated = true }
  }
  if (!category.winsToQualify) { category.winsToQualify = Math.min(3, category.poolSize - 1); migrated = true }
  if (category.playoff === undefined) { category.playoff = null; migrated = true }
  for (const registration of category.registrations) {
    for (const [key, value] of [['paid', false], ['paymentRef', ''], ['contact', ''], ['devices', []]]) {
      if (registration[key] === undefined) { registration[key] = value; migrated = true }
    }
    if (!registration.accessCode) { registration.accessCode = newAccessCode(); migrated = true }
    for (const player of registration.players) {
      if (typeof player.photo === 'string' && player.photo.startsWith('data:')) {
        await beforeMigration()
        if (!photoCache.has(player.photo)) {
          let id = null
          try { id = await storePhoto(image(player.photo)) } catch { console.warn(`Skipped an unreadable photo for ${player.name} in ${category.title}.`) }
          photoCache.set(player.photo, id)
        }
        player.photoId = photoCache.get(player.photo)
        delete player.photo
        migrated = true
      }
    }
  }
  // Draw pools used to copy each team (with photos); now they only reference registrations.
  for (const pool of category.draw?.pools ?? []) {
    if (pool.teams.some((team) => Object.keys(team).length > 1)) {
      await beforeMigration()
      pool.teams = pool.teams.map((team) => ({ id: team.id }))
      migrated = true
    }
  }
  for (const match of allMatches(category)) {
    if (!Array.isArray(match.scoreEvents)) { match.scoreEvents = []; migrated = true }
    if (!Array.isArray(match.rallyHistory)) { match.rallyHistory = []; migrated = true }
    if (match.serveTeam !== 1 && match.serveTeam !== 2) { match.serveTeam = 1; migrated = true }
    if (match.serveNumber !== 1 && match.serveNumber !== 2) { match.serveNumber = category.format === 'singles' ? 1 : 2; migrated = true }
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

function applySettings(category, input, creating) {
  const locked = (label) => { throw new Error(`${label} cannot change after ${category.draw ? 'the draw is published' : 'teams have registered'}.`) }
  const has = (key) => input[key] !== undefined
  if (has('title')) category.title = requiredText(input.title, 'Category name', 60)
  if (has('division')) category.division = requiredText(input.division, 'Division', 40)
  if (has('rules')) category.rules = requiredText(input.rules, 'Rules', 500)
  if (has('fee')) {
    const fee = Number(input.fee)
    if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_000) throw new Error('Fee must be 0 or more.')
    category.fee = fee
  }
  if (has('requirePayment')) category.requirePayment = Boolean(input.requirePayment)
  if (has('privateBoard')) category.privateBoard = Boolean(input.privateBoard)
  if (has('format') || has('eligibility')) {
    if (!creating && category.registrations.length && (input.format !== category.format || input.eligibility !== category.eligibility)) locked('Team format and eligibility')
    const format = ['doubles', 'mixed-doubles', 'singles'].includes(input.format) ? input.format : null
    const eligibility = ['open', 'men', 'women', 'genderless'].includes(input.eligibility) ? input.eligibility : null
    if (!format || !eligibility) throw new Error('Choose a team format and eligibility.')
    if (format === 'mixed-doubles' && eligibility !== 'open') throw new Error('Mixed doubles must use open eligibility.')
    category.format = format; category.eligibility = eligibility
  }
  if (has('capacity')) {
    const capacity = wholeNumber(input.capacity, 'Team slots', 2, 128)
    if (capacity < activeEntries(category)) throw new Error(`${activeEntries(category)} teams are already entered. Reject some before lowering the slots.`)
    category.capacity = capacity
  }
  if (has('poolSize') && Number(input.poolSize) !== category.poolSize) {
    if (category.draw) locked('Teams per pool')
    category.poolSize = wholeNumber(input.poolSize, 'Teams per pool', 2, 12)
  }
  if (has('courts') && Number(input.courts) !== category.courts) {
    if (category.draw) locked('Courts')
    category.courts = wholeNumber(input.courts, 'Courts', 1, 20)
  }
  if ((has('pointsToWin') && Number(input.pointsToWin) !== category.pointsToWin) || (has('winBy') && Number(input.winBy) !== category.winBy)) {
    if (hasResults(category)) throw new Error('Scoring rules cannot change after scores are recorded.')
    if (has('pointsToWin')) category.pointsToWin = wholeNumber(input.pointsToWin, 'Points to win', 1, 99)
    if (has('winBy')) category.winBy = wholeNumber(input.winBy, 'Win by', 1, 5)
  }
  const qualifyChange = ['qualifyMode', 'qualifyTop', 'winsToQualify'].some((key) => has(key) && input[key] !== category[key])
  if (qualifyChange) {
    if (category.playoff) throw new Error('Qualification is locked after the playoff bracket is published.')
    if (has('qualifyMode')) {
      if (!['top', 'wins'].includes(input.qualifyMode)) throw new Error('Choose top teams per pool or minimum wins.')
      category.qualifyMode = input.qualifyMode
    }
    if (has('qualifyTop')) category.qualifyTop = wholeNumber(input.qualifyTop, 'Teams per pool that qualify', 1, category.poolSize)
    if (has('winsToQualify')) category.winsToQualify = wholeNumber(input.winsToQualify, 'Wins to qualify', 1, Math.max(1, category.poolSize - 1))
  }
  if (category.qualifyTop > category.poolSize) category.qualifyTop = category.poolSize
  if (category.winsToQualify > Math.max(1, category.poolSize - 1)) category.winsToQualify = Math.max(1, category.poolSize - 1)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'api') return await serveSite(req, res, url.pathname)

    if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { publicBaseUrl })

    if (req.method === 'GET' && parts[1] === 'photos' && parts.length === 3) {
      if (!photoIdPattern.test(parts[2])) return send(res, 404, { error: 'Photo not found.' })
      try {
        const content = await readFile(join(photoDir, parts[2]))
        res.writeHead(200, { 'Content-Type': staticTypes[extname(parts[2])], 'Cache-Control': 'public, max-age=31536000, immutable' })
        return res.end(content)
      } catch { return send(res, 404, { error: 'Photo not found.' }) }
    }

    const user = currentUser(req)
    if (req.method === 'GET' && url.pathname === '/api/admin/status') return send(res, 200, { needsSetup: database.users.length === 0 })
    if (req.method === 'POST' && url.pathname === '/api/admin/setup') {
      const input = await body(req)
      if (database.users.length) throw new Error('Setup is already done. Sign in instead.')
      checkPin(req, input.pin)
      const owner = { id: randomUUID(), username: validUsername(input.username), name: requiredText(input.name, 'Your name', 60), role: 'owner', passwordHash: await hashPassword(validPassword(input.password)), createdAt: new Date().toISOString() }
      database.users.push(owner)
      const token = startSession(owner)
      audit(owner, 'Created the owner account', null)
      await save()
      return send(res, 201, { token, user: publicUser(owner) })
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const input = await body(req)
      if (loginLocked(req)) return send(res, 429, { error: lockedError().message })
      const account = database.users.find((item) => item.username === String(input.username || '').trim().toLowerCase())
      // Hash even for unknown usernames so response time does not reveal which accounts exist.
      const matches = await passwordMatches(String(input.password || ''), account?.passwordHash)
      if (!account || !matches) { noteFailure(req); return send(res, 401, { error: 'Wrong username or password.' }) }
      if (account.disabled) return send(res, 403, { error: 'This organizer account is disabled. Ask the owner.' })
      failedLogins.delete(clientKey(req))
      const token = startSession(account)
      await save()
      return send(res, 200, { token, user: publicUser(account) })
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/recover') {
      const input = await body(req)
      checkPin(req, input.pin)
      const account = database.users.find((item) => item.username === String(input.username || '').trim().toLowerCase())
      if (!account) throw new Error('No organizer has that username.')
      account.passwordHash = await hashPassword(validPassword(input.password))
      account.disabled = false
      database.sessions = database.sessions.filter((item) => item.userId !== account.id)
      const token = startSession(account)
      audit(account, 'Reset own password with the setup PIN', null)
      await save()
      return send(res, 200, { token, user: publicUser(account) })
    }
    if (url.pathname.startsWith('/api/admin/') && !user) return send(res, 401, { error: 'Organizer login required.' })
    if (req.method === 'GET' && url.pathname === '/api/admin/me') return send(res, 200, { user: publicUser(user) })
    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      const hash = tokenHash(String(req.headers.authorization).slice(7).trim())
      database.sessions = database.sessions.filter((item) => item.tokenHash !== hash)
      await save()
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/password') {
      const input = await body(req)
      if (!(await passwordMatches(String(input.current || ''), user.passwordHash))) throw new Error('Current password is wrong.')
      user.passwordHash = await hashPassword(validPassword(input.next))
      const keep = tokenHash(String(req.headers.authorization).slice(7).trim())
      database.sessions = database.sessions.filter((item) => item.userId !== user.id || item.tokenHash === keep)
      audit(user, 'Changed own password', null)
      await save()
      return send(res, 200, { ok: true })
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/activity') return send(res, 200, database.audit.slice(0, 200))
    if (parts[1] === 'admin' && parts[2] === 'users') {
      if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can manage organizer accounts.' })
      if (req.method === 'GET' && parts.length === 3) return send(res, 200, database.users.map(publicUser))
      if (req.method === 'POST' && parts.length === 3) {
        const input = await body(req)
        const username = validUsername(input.username)
        if (database.users.some((item) => item.username === username)) throw new Error('That username is taken.')
        const account = { id: randomUUID(), username, name: requiredText(input.name, 'Name', 60), role: input.role === 'owner' ? 'owner' : 'organizer', passwordHash: await hashPassword(validPassword(input.password)), createdAt: new Date().toISOString() }
        database.users.push(account)
        audit(user, `Added ${account.role} ${account.name} (${account.username})`, null)
        await save()
        return send(res, 201, publicUser(account))
      }
      const account = database.users.find((item) => item.id === parts[3])
      if (req.method === 'PATCH' && account && parts.length === 4) {
        const input = await body(req)
        const next = { ...account }
        if (input.name !== undefined) next.name = requiredText(input.name, 'Name', 60)
        if (input.role !== undefined) next.role = input.role === 'owner' ? 'owner' : 'organizer'
        if (input.disabled !== undefined) next.disabled = Boolean(input.disabled)
        if (account.id === user.id && (next.disabled || next.role !== 'owner')) throw new Error('You cannot disable or demote your own account.')
        if (account.role === 'owner' && (next.disabled || next.role !== 'owner') && activeOwners().length <= 1) throw new Error('Keep at least one active owner.')
        if (input.password !== undefined) next.passwordHash = await hashPassword(validPassword(input.password))
        Object.assign(account, next)
        if (next.disabled || input.password !== undefined) database.sessions = database.sessions.filter((item) => item.userId !== account.id)
        audit(user, [input.password !== undefined && `Reset password for ${account.name}`, input.disabled !== undefined && `${account.disabled ? 'Disabled' : 'Enabled'} ${account.name}`, input.role !== undefined && `Set ${account.name} as ${account.role}`].filter(Boolean).join('; ') || `Updated ${account.name}`, null)
        await save()
        return send(res, 200, publicUser(account))
      }
      return send(res, 404, { error: 'Organizer not found.' })
    }
    if (req.method === 'GET' && url.pathname === '/api/categories') {
      return send(res, 200, database.categories.filter((item) => item.published).map((item) => publicCategory(item, canSeeBoard(req, item, user))))
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/categories') {
      if (!user) return send(res, 401, { error: 'Organizer login required.' })
      return send(res, 200, database.categories.map(adminCategory))
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/backup') {
      if (!user) return send(res, 401, { error: 'Organizer login required.' })
      // Session tokens stay on the server; the download still includes accounts so a restore keeps logins working.
      return sendFile(res, 200, JSON.stringify({ ...database, sessions: [] }, null, 2), 'application/json; charset=utf-8', `pbb-backup-${stamp()}.json`)
    }
    if (req.method === 'POST' && url.pathname === '/api/categories') {
      if (!user) return send(res, 401, { error: 'Organizer login required.' })
      const input = await body(req)
      const category = {
        id: randomUUID(), title: '', division: '', format: 'doubles', eligibility: 'genderless', fee: 0, capacity: 2, poolSize: 2, courts: 1,
        pointsToWin: 11, winBy: 2, winsToQualify: 1, qualifyMode: 'top', qualifyTop: 2, requirePayment: false, privateBoard: true, endedAt: null, rules: '',
        published: true, createdAt: new Date().toISOString(), registrations: [], draw: null, playoff: null,
        stationToken: randomBytes(24).toString('base64url'),
      }
      applySettings(category, {
        ...input,
        title: input.title ?? '', division: input.division ?? '', rules: input.rules ?? '',
        format: input.format, eligibility: input.eligibility, fee: input.fee ?? 0,
        poolSize: input.poolSize, courts: input.courts, capacity: input.capacity,
        requirePayment: input.requirePayment ?? Number(input.fee) > 0,
        qualifyMode: input.qualifyMode ?? 'top',
      }, true)
      database.categories.unshift(category)
      audit(user, 'Created category', category)
      await save()
      return send(res, 201, adminCategory(category))
    }
    if (parts.length >= 3 && parts[1] === 'categories') {
      const category = database.categories.find((item) => item.id === parts[2])
      if (!category) return send(res, 404, { error: 'Category not found.' })
      const stationAccess = sameSecret(req.headers['x-station-token'], category.stationToken)
      if (req.method === 'GET' && parts[3] === 'station' && parts.length === 4) {
        if (!user && !stationAccess) return send(res, 403, { error: 'Scan the organizer court QR to open scoring.' })
        const names = new Map(category.registrations.map((item) => [item.id, teamView(item)]))
        return send(res, 200, {
          title: category.title, courts: category.courts,
          matches: allMatches(category).map((match) => ({ ...publicMatch(match),
            team1Name: names.get(match.team1)?.teamName ?? 'Waiting for opponent',
            team2Name: names.get(match.team2)?.teamName ?? 'Waiting for opponent',
          })),
        })
      }
      if (req.method === 'GET' && parts.length === 3) {
        if (!category.published) return send(res, 404, { error: 'Category not found.' })
        const player = playerFor(req, category)
        return send(res, 200, { ...publicCategory(category, canSeeBoard(req, category, user)), viewer: player ? { teamId: player.id, teamName: player.teamName } : null })
      }
      if (req.method === 'PATCH' && parts.length === 3) {
        if (!user) return send(res, 401, { error: 'Organizer login required.' })
        const input = await body(req)
        // Validate on a copy so a rejected edit changes nothing.
        const draft = structuredClone(category)
        applySettings(draft, input, false)
        const changed = Object.keys(input).filter((key) => JSON.stringify(category[key]) !== JSON.stringify(draft[key]))
        Object.assign(category, draft)
        audit(user, 'Edited settings', category, changed.join(', '))
        await save()
        return send(res, 200, adminCategory(category))
      }
      if (req.method === 'DELETE' && parts.length === 3) {
        if (!user) return send(res, 401, { error: 'Organizer login required.' })
        await backupNow('before-delete')
        database.categories = database.categories.filter((item) => item.id !== category.id)
        audit(user, 'Deleted category', category, `${category.registrations.length} registrations`)
        await save()
        return send(res, 200, { ok: true })
      }
      if (req.method === 'GET' && parts[3] === 'export') {
        if (!user) return send(res, 401, { error: 'Organizer login required.' })
        const kind = ['registrations', 'results', 'standings'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'results'
        const safeTitle = category.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category'
        return sendFile(res, 200, toCsv(exportRows(category, kind)), 'text/csv; charset=utf-8', `${safeTitle}-${kind}.csv`)
      }
      if (parts[3] === 'matches' && parts[4]) {
        const match = allMatches(category).find((item) => item.id === parts[4])
        if (!match) return send(res, 404, { error: 'Match not found.' })
        const teamById = new Map(category.registrations.map((item) => [item.id, teamView(item)]))
        const scoringView = () => ({ ...publicMatch(match), scoreEvents: match.scoreEvents ?? [], canUndo: Boolean(match.rallyHistory?.length) })
        if (req.method === 'GET' && parts.length === 5 && !canSeeBoard(req, category, user) && !stationAccess && !sameSecret(req.headers['x-score-token'], match.scoreToken)) return send(res, 403, { error: 'This board is private. Enter your team code on the category page.' })
        if (req.method === 'GET' && parts.length === 5) return send(res, 200, {
          categoryId: category.id, categoryTitle: category.title, format: category.format, pointsToWin: category.pointsToWin ?? 11,
          winBy: category.winBy ?? 2, match: scoringView(),
          team1: teamById.get(match.team1) || null, team2: teamById.get(match.team2) || null,
        })
        if (req.method === 'PATCH' && parts[5] === 'rally') {
          if (!user && !stationAccess && !sameSecret(req.headers['x-score-token'], match.scoreToken)) return send(res, 403, { error: 'Scan the organizer QR code to score this match.' })
          if (match.status === 'final' || match.status === 'bye') throw new Error('This match is already decided.')
          if (match.stage === 'pool' && category.playoff) throw new Error('Pool scores are locked after the playoff bracket is published.')
          if (!match.team1 || !match.team2) throw new Error('Both opponents must be known before scoring.')
          const input = await body(req)
          if (Number(input.version) !== (match.version ?? 0)) return send(res, 409, { error: 'Score changed on another device. Refresh and try again.' })
          if (!['point', 'lost-serve', 'undo', 'set-serve'].includes(input.action)) throw new Error('Choose a valid rally action.')
          match.scoreEvents ??= []
          match.rallyHistory ??= []
          const before = { score1: match.score1, score2: match.score2, status: match.status, serveTeam: match.serveTeam, serveNumber: match.serveNumber }
          let eventTeam = null
          let change = 0
          if (input.action === 'undo') {
            const previous = match.rallyHistory.pop()
            if (!previous) throw new Error('There is no rally action to undo.')
            Object.assign(match, previous)
          } else {
            if (validFinal(match.score1, match.score2, category.pointsToWin ?? 11, category.winBy ?? 2)) throw new Error('Game point is reached. Confirm the result or undo the last action.')
            if (input.action === 'point') {
              if (Number(input.team) !== match.serveTeam) throw new Error('Only the serving team can score. Tap the yellow server number to change serve.')
              const key = match.serveTeam === 1 ? 'score1' : 'score2'
              if (match[key] >= 999) throw new Error('Score limit reached.')
              match[key] += 1
              eventTeam = match.serveTeam
              change = 1
            } else if (input.action === 'lost-serve') {
              if (category.format !== 'singles' && match.serveNumber === 1) match.serveNumber = 2
              else { match.serveTeam = match.serveTeam === 1 ? 2 : 1; match.serveNumber = 1 }
              eventTeam = match.serveTeam
            } else {
              if (![1, 2].includes(Number(input.team)) || ![1, 2].includes(Number(input.serveNumber))) throw new Error('Choose a team and server number.')
              if (category.format === 'singles' && Number(input.serveNumber) !== 1) throw new Error('Singles has one server per side.')
              match.serveTeam = Number(input.team)
              match.serveNumber = Number(input.serveNumber)
              eventTeam = match.serveTeam
            }
            match.rallyHistory.push(before)
            match.status = 'live'
          }
          match.version = (match.version ?? 0) + 1
          match.scoreEvents.push({ id: randomUUID(), action: input.action, team: eventTeam, change,
            score1: match.score1, score2: match.score2, serveTeam: match.serveTeam, serveNumber: match.serveNumber, at: new Date().toISOString() })
          await save()
          return send(res, 200, scoringView())
        }
        if (req.method === 'PATCH' && parts[5] === 'score') {
          const admin = Boolean(user)
          const token = req.headers['x-score-token']
          if (!admin && !stationAccess && !sameSecret(token, match.scoreToken)) return send(res, 403, { error: 'Scan the organizer QR code to score this match.' })
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
          if (!admin && (input.status !== 'final' || first !== match.score1 || second !== match.score2)) throw new Error('Use the rally controls to score. A QR scorer can only confirm the current final result.')
          if (input.status === 'final' && !validFinal(first, second, category.pointsToWin ?? 11, category.winBy ?? 2)) throw new Error(`Not a valid final: first to ${category.pointsToWin ?? 11}, win by ${category.winBy ?? 2} (past ${category.pointsToWin ?? 11} the lead must be exactly ${category.winBy ?? 2}).`)
          if (input.status !== 'final' && match.status === 'final' && match.stage === 'playoff') {
            const next = dependentMatch(category.playoff.rounds, match)
            if (next && ['live', 'final'].includes(next.status)) throw new Error('The next playoff match already started with this winner. Reopen that match first.')
          }
          const previousStatus = match.status
          const previousFirst = match.score1
          const previousSecond = match.score2
          match.score1 = first; match.score2 = second; match.status = input.status
          if (first !== previousFirst || second !== previousSecond) match.rallyHistory = []
          if (first !== previousFirst || second !== previousSecond) {
            match.scoreEvents ??= []
            match.scoreEvents.push({ id: randomUUID(), team: first !== previousFirst && second === previousSecond ? 1 : second !== previousSecond && first === previousFirst ? 2 : null,
              change: first - previousFirst || second - previousSecond, score1: first, score2: second, at: new Date().toISOString() })
          }
          match.winner = input.status === 'final' ? first > second ? match.team1 : match.team2 : null
          const wasFinal = previousStatus === 'final'
          match.version = (match.version ?? 0) + 1
          if (match.stage === 'playoff') advancePlayoff(category.playoff.rounds, category.format)
          const names = new Map(category.registrations.map((item) => [item.id, item.teamName]))
          const label = `${match.stage === 'pool' ? `${match.pool} game ${match.game}` : 'Playoff'}: ${names.get(match.team1)} ${match.score1}-${match.score2} ${names.get(match.team2)}`
          if (input.status === 'final') audit(admin ? user : null, 'Final score', category, label)
          else if (wasFinal) audit(user, 'Reopened a final score', category, label)
          await save()
          return send(res, 200, scoringView())
        }
      }
      if (req.method === 'POST' && parts[3] === 'register') {
        if (!category.published || category.draw || category.endedAt) throw new Error('Registration is closed for this category.')
        if (activeEntries(category) >= category.capacity) throw new Error('This category is full.')
        const input = await body(req)
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
        const teamName = requiredText(input.teamName, 'Team name', 70)
        const contact = contactNumber(input.contact)
        const paymentRef = optionalText(input.paymentRef, 'Payment reference', 60)
        // Re-check after the upload finishes; other entries or the draw may have landed meanwhile.
        if (category.draw) throw new Error('Registration is closed for this category.')
        if (activeEntries(category) >= category.capacity) throw new Error('This category is full.')
        if (category.registrations.some((item) => item.status !== 'rejected' && item.teamName.toLowerCase() === teamName.toLowerCase())) throw new Error('That team name is already registered in this category.')
        const stored = []
        for (const player of cleaned) stored.push({ name: player.name, gender: player.gender, photoId: await storePhoto(player.photo) })
        const registration = { id: randomUUID(), teamName, players: stored, contact, paymentRef, paid: false, status: 'pending', accessCode: newAccessCode(), devices: [], createdAt: new Date().toISOString() }
        category.registrations.push(registration)
        await save()
        return send(res, 201, { id: registration.id, status: registration.status, teamName: registration.teamName })
      }
      if (req.method === 'GET' && parts[3] === 'registration' && parts[4]) {
        const registration = category.registrations.find((item) => item.id === parts[4])
        if (!registration) return send(res, 404, { error: 'Registration not found.' })
        const assignment = category.draw?.pools.find((pool) => pool.teams.some((team) => team.id === registration.id))
        return send(res, 200, {
          id: registration.id, teamName: registration.teamName, status: registration.status,
          paid: Boolean(registration.paid), requirePayment: Boolean(category.requirePayment),
          // The team code is revealed on the team's own entry page once approved, until the event ends.
          accessCode: registration.status === 'approved' && !category.endedAt ? registration.accessCode : null,
          devicesUsed: registration.devices?.length ?? 0, deviceLimit: deviceLimit(registration), ended: Boolean(category.endedAt),
          pool: assignment?.name ?? null, court: assignment?.court ?? null,
          matches: category.draw?.matches.filter((match) => match.team1 === registration.id || match.team2 === registration.id).map(publicMatch) ?? [],
        })
      }
      if (req.method === 'POST' && parts[3] === 'access' && parts.length === 4) {
        const input = await body(req)
        if (loginLocked(req)) throw lockedError()
        if (category.endedAt) throw new Error('This event has ended, so team codes no longer work.')
        const code = normalizeCode(input.code)
        const entry = code ? category.registrations.find((item) => item.accessCode === code) : null
        if (!entry) { noteFailure(req); throw new Error('That code does not match a team in this category.') }
        failedLogins.delete(clientKey(req))
        if (entry.status !== 'approved') throw new Error('Your team is not approved yet. The code works once the organizer approves your entry.')
        if (entry.devices.length >= deviceLimit(entry)) throw new Error(`This code is already in use on ${deviceLimit(entry)} phone${deviceLimit(entry) === 1 ? '' : 's'}. Sign out on another phone, or ask the organizer to reset the code.`)
        const token = randomBytes(32).toString('base64url')
        entry.devices.push({ tokenHash: tokenHash(token), at: new Date().toISOString() })
        audit(null, `${entry.teamName}: team code used on a phone (${entry.devices.length}/${deviceLimit(entry)})`, category)
        await save()
        return send(res, 200, { token, teamId: entry.id, teamName: entry.teamName })
      }
      if (req.method === 'DELETE' && parts[3] === 'access' && parts.length === 4) {
        const hash = tokenHash(String(req.headers['x-player-token'] || '').split(',')[0].trim())
        for (const entry of category.registrations) entry.devices = (entry.devices ?? []).filter((device) => device.tokenHash !== hash)
        await save()
        return send(res, 200, { ok: true })
      }
      if (req.method === 'POST' && parts[3] === 'registrations' && parts[4] && parts[5] === 'reset-code') {
        if (!user) return send(res, 401, { error: 'Organizer login required.' })
        const entry = category.registrations.find((item) => item.id === parts[4])
        if (!entry) return send(res, 404, { error: 'Registration not found.' })
        entry.accessCode = newAccessCode()
        entry.devices = []
        audit(user, `${entry.teamName}: reset team code (all phones signed out)`, category)
        await save()
        return send(res, 200, adminRegistration(entry))
      }
      if (req.method === 'POST' && parts[3] === 'end' && parts.length === 4) {
        if (!user) return send(res, 401, { error: 'Organizer login required.' })
        const input = await body(req)
        if (input.ended === false) {
          category.endedAt = null
          audit(user, 'Reopened the event', category)
        } else {
          if (category.endedAt) throw new Error('This event has already ended.')
          await backupNow('before-end-event')
          category.endedAt = new Date().toISOString()
          // Every team code stops working; phones that were signed in lose access on their next refresh.
          for (const entry of category.registrations) entry.devices = []
          audit(user, 'Ended the event (team codes expired)', category)
        }
        await save()
        return send(res, 200, adminCategory(category))
      }
      if (req.method === 'PATCH' && parts[3] === 'registrations' && parts[4]) {
        if (!user) return send(res, 401, { error: 'Organizer login required.' })
        const registration = category.registrations.find((item) => item.id === parts[4])
        if (!registration) return send(res, 404, { error: 'Registration not found.' })
        const input = await body(req)
        const next = structuredClone(registration)
        if (input.paid !== undefined) next.paid = Boolean(input.paid)
        if (input.paymentRef !== undefined) next.paymentRef = optionalText(input.paymentRef, 'Payment reference', 60)
        if (input.contact !== undefined) next.contact = contactNumber(input.contact)
        if (input.teamName !== undefined) {
          next.teamName = requiredText(input.teamName, 'Team name', 70)
          if (category.registrations.some((item) => item.id !== next.id && item.status !== 'rejected' && item.teamName.toLowerCase() === next.teamName.toLowerCase())) throw new Error('Another team already uses that name.')
        }
        if (input.playerNames !== undefined) {
          if (!Array.isArray(input.playerNames) || input.playerNames.length !== next.players.length) throw new Error('Send one name per player.')
          next.players = next.players.map((player, index) => ({ ...player, name: requiredText(input.playerNames[index], `Player ${index + 1} name`, 70) }))
        }
        if (input.status !== undefined && input.status !== registration.status) {
          if (category.draw) throw new Error('Entries are locked once the draw is published. Undo the draw first.')
          if (!['approved', 'rejected', 'pending'].includes(input.status)) throw new Error('Invalid registration status.')
          if (registration.status === 'rejected' && activeEntries(category) >= category.capacity) throw new Error('All team slots are taken. Reject another entry first.')
          if (input.status === 'approved' && category.requirePayment && !next.paid) throw new Error(`Mark ${next.teamName} as paid before approving.`)
          next.status = input.status
        }
        const changes = [
          next.status !== registration.status && next.status,
          next.paid !== registration.paid && (next.paid ? 'marked paid' : 'marked unpaid'),
          next.teamName !== registration.teamName && `renamed from ${registration.teamName}`,
          JSON.stringify(next.players) !== JSON.stringify(registration.players) && 'player names edited',
          (next.contact !== registration.contact || next.paymentRef !== registration.paymentRef) && 'contact/reference edited',
        ].filter(Boolean)
        Object.assign(registration, next)
        if (changes.length) audit(user, `${registration.teamName}: ${changes.join(', ')}`, category)
        await save()
        return send(res, 200, adminRegistration(registration))
      }
      if (req.method === 'POST' && parts[3] === 'draw') {
        if (!user) return send(res, 401, { error: 'Organizer login required.' })
        if (category.draw) throw new Error('The draw is already published.')
        category.draw = createDraw(category)
        audit(user, 'Published the random draw', category, `${category.draw.pools.length} pools, ${category.draw.matches.length} games`)
        await save()
        return send(res, 200, publicCategory(category))
      }
      if (req.method === 'DELETE' && parts[3] === 'draw') {
        if (!user) return send(res, 401, { error: 'Organizer login required.' })
        if (!category.draw) throw new Error('There is no draw to undo.')
        if (category.playoff || hasResults(category)) throw new Error('Scores are already recorded, so the draw can no longer be undone.')
        await backupNow('before-undo-draw')
        category.draw = null
        audit(user, 'Undid the draw', category)
        await save()
        return send(res, 200, adminCategory(category))
      }
      if (req.method === 'POST' && parts[3] === 'playoff') {
        if (!user) return send(res, 401, { error: 'Organizer login required.' })
        if (category.playoff) throw new Error('Playoff bracket is already published.')
        category.playoff = createPlayoff(category)
        audit(user, 'Published the playoff bracket', category)
        await save()
        return send(res, 200, publicCategory(category))
      }
    }
    return send(res, 404, { error: 'Not found' })
  } catch (error) {
    send(res, 400, { error: error.message || 'Request failed.' })
  }
})

// On a VPS set HOST=127.0.0.1 so only the HTTPS proxy in front can reach this port.
server.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`PBB Pickleball API listening on http://127.0.0.1:${port}`)
  console.log(`Player registration links use ${publicBaseUrl}`)
  console.log(`Data: ${dataFile} (backups in ${backupDir})`)
  if (servesSite) console.log(`Serving the built site from ${distDir}`)
  const pinNote = process.env.ADMIN_PIN ? 'set by ADMIN_PIN' : `${adminPin} (kept in ${pinFile}; set ADMIN_PIN to choose your own)`
  console.log(database.users.length
    ? `Organizer accounts: ${database.users.length}. Setup/recovery PIN: ${pinNote}`
    : `No organizer accounts yet. Open Organizer and create the owner account with setup PIN: ${pinNote}`)
})
