import { spawn } from 'node:child_process'

const api = spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env: { ...process.env, RALLY_DEV: '1' } })
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { stdio: 'inherit', env: process.env })
function stop() { api.kill(); vite.kill() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
api.on('exit', (code) => { if (code) { vite.kill(); process.exitCode = code } })
vite.on('exit', (code) => { api.kill(); process.exitCode = code || 0 })
