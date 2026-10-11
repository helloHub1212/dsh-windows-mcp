#!/usr/bin/env node
// Minimal MCP stdio handshake probe: initialize -> initialized -> tools/list.
// usage: node tools/mcp-handshake.mjs <command> [args...]
import { spawn } from 'node:child_process'

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) { console.error('usage: mcp-handshake.mjs <cmd> [args...]'); process.exit(2) }

const started = Date.now()
const child = spawn(cmd, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ANONYMIZED_TELEMETRY: 'false', WINDOWS_MCP_DISABLE_FLASH: '1' },
  windowsHide: true,
})

let buf = ''
let stderr = ''
const pending = new Map()
let nextId = 1

child.stdout.on('data', (d) => { buf += d.toString('utf8'); drain() })
child.stderr.on('data', (d) => { stderr += d.toString('utf8'); if (stderr.length > 8000) stderr = stderr.slice(-8000) })

function drain() {
  for (;;) {
    const nl = buf.indexOf('\n')
    if (nl < 0) return
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { console.log('[non-json stdout] ' + line.slice(0, 300)); continue }
    const resolve = pending.get(msg.id)
    if (resolve) { pending.delete(msg.id); resolve(msg) }
    else if (msg.method) console.log(`[server->client] ${msg.method}`)
  }
}

function rpc(method, params) {
  const id = nextId++
  const req = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }
  child.stdin.write(JSON.stringify(req) + '\n')
  return new Promise((resolve, reject) => {
    pending.set(id, resolve)
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`)) }, 900000)
  })
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n')
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { roots: {}, sampling: {} },
    clientInfo: { name: 'dsh-feasibility-probe', version: '0.0.0' },
  })
  const ms = Date.now() - started
  console.log(`=== initialize ok in ${ms} ms ===`)
  console.log(JSON.stringify(init.result?.serverInfo ?? init.result, null, 2))
  console.log('capabilities: ' + JSON.stringify(init.result?.capabilities))
  notify('notifications/initialized')

  const list = await rpc('tools/list', {})
  const tools = list.result?.tools ?? []
  console.log(`=== tools/list: ${tools.length} tools ===`)
  for (const t of tools) {
    const ann = t.annotations ? ` [${Object.entries(t.annotations).filter(([, v]) => v === true).map(([k]) => k).join(',')}]` : ''
    console.log(`- ${t.name}${ann}: ${(t.description ?? '').split('\n')[0].slice(0, 110)}`)
  }
  console.log('=== raw schema of Screenshot ===')
  console.log(JSON.stringify(tools.find((t) => t.name === 'Screenshot')?.inputSchema, null, 2)?.slice(0, 2500))

  for (const m of ['resources/list', 'resources/templates/list', 'prompts/list']) {
    try { const r = await rpc(m, {}); console.log(`=== ${m} ===\n` + JSON.stringify(r.result ?? r.error).slice(0, 800)) }
    catch (e) { console.log(`=== ${m} failed: ${e.message}`) }
  }
} catch (e) {
  console.log('=== PROBE FAILED: ' + e.message)
} finally {
  console.log('=== stderr tail ===\n' + stderr.slice(-3000))
  child.kill()
  setTimeout(() => process.exit(0), 300)
}
