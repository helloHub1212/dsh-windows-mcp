#!/usr/bin/env node
// Minimal read-only Electron ASAR inspector (no deps).
// usage:
//   node probe-asar.mjs <asar> list <substr> [limit]
//   node probe-asar.mjs <asar> cat <internal/path>
//   node probe-asar.mjs <asar> grep <internal/path> <substr>
import { readFileSync } from 'node:fs'

const [asarPath, action, a1, a2] = process.argv.slice(2)
if (!asarPath || !action) {
  console.error('usage: probe-asar.mjs <asar> list <substr> [limit] | cat <path> | grep <path> <substr>')
  process.exit(2)
}

const buf = readFileSync(asarPath)
const MAGIC = Buffer.from('{"files"')
const idx = buf.indexOf(MAGIC)
if (idx < 0) { console.error('not an asar (no {"files" header found)'); process.exit(1) }
const headerLen = buf.readUInt32LE(idx - 4)
const header = JSON.parse(buf.toString('utf8', idx, idx + headerLen))
const baseOffset = idx + headerLen

const paths = []
const walk = (node, prefix) => {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = `${prefix}/${name}`
    if (entry.files) walk(entry, p)
    else paths.push(p)
  }
}
walk(header, '')

const readEntry = (p) => {
  let node = header
  for (const seg of p.split('/').filter(Boolean)) {
    node = node.files?.[seg]
    if (!node) return null
  }
  if (!node || node.files) return null
  const off = baseOffset + Number(node.offset)
  return buf.subarray(off, off + Number(node.size))
}

switch (action) {
  case 'list': {
    const needle = a1 ?? ''
    const limit = Number(a2 ?? 200)
    const hits = paths.filter((p) => p.includes(needle))
    console.log(`total entries: ${paths.length}; matching "${needle}": ${hits.length}`)
    for (const h of hits.slice(0, limit)) console.log(h)
    if (hits.length > limit) console.log(`... (+${hits.length - limit} more)`)
    break
  }
  case 'cat': {
    const data = readEntry(a1)
    if (!data) { console.error(`not found: ${a1}`); process.exit(1) }
    process.stdout.write(data.toString('utf8'))
    break
  }
  case 'grep': {
    const data = readEntry(a1)
    if (!data) { console.error(`not found: ${a1}`); process.exit(1) }
    const text = data.toString('utf8')
    const lines = text.split('\n')
    let n = 0
    lines.forEach((l, i) => {
      if (a2 && l.includes(a2)) { n++; console.log(`${i + 1}: ${l.trim().slice(0, 300)}`) }
    })
    console.log(`-- matches: ${n} in ${a1} (${data.length} bytes)`)
    break
  }
  case 'grepall': {
    // grepall <pathSubstr> <needle> [limit]
    const pathNeedle = a1 ?? ''
    const needle = a2 ?? ''
    const limit = 60
    let files = 0
    let hits = 0
    for (const p of paths) {
      if (!p.includes(pathNeedle)) continue
      if (!/\.(js|mjs|cjs|md|json|yml|yaml)$/.test(p)) continue
      const data = readEntry(p)
      if (!data) continue
      files++
      const text = data.toString('utf8')
      let line = 0
      for (const l of text.split('\n')) {
        line++
        if (!l.includes(needle)) continue
        hits++
        if (hits <= limit) console.log(`${p}:${line}: ${l.trim().slice(0, 240)}`)
      }
    }
    console.log(`-- scanned ${files} file(s) under "${pathNeedle}"; matches: ${hits}`)
    break
  }
  default:
    console.error(`unknown action: ${action}`)
    process.exit(2)
}
