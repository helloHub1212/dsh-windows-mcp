import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { uvInstallEnvironment } from '../lib/dependency.js'
import { executableIn } from '../lib/installs.js'

test('managed installs get their own console-script bin directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'windows-mcp-tool-'))
  const env = uvInstallEnvironment(dir)
  assert.equal(env.UV_TOOL_DIR, dir)
  assert.equal(env.UV_TOOL_BIN_DIR, join(dir, 'bin'))
})

test('a managed executable is found in the isolated bin directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'windows-mcp-tool-'))
  mkdirSync(join(dir, 'bin'), { recursive: true })
  const exe = join(dir, 'bin', process.platform === 'win32' ? 'windows-mcp.exe' : 'windows-mcp')
  writeFileSync(exe, '')
  assert.equal(executableIn(dir), exe)
})

test('a legacy managed install in Scripts still resolves', () => {
  const dir = mkdtempSync(join(tmpdir(), 'windows-mcp-tool-'))
  mkdirSync(join(dir, 'Scripts'), { recursive: true })
  const exe = join(dir, 'Scripts', 'windows-mcp.exe')
  writeFileSync(exe, '')
  assert.equal(executableIn(dir), exe)
})
