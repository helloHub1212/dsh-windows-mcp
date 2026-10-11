# tools/

Zero-dependency debug probes used while building this plugin. They are not
published to npm (`package.json#files` omits this directory) and nothing in
`lib/` imports them.

### `probe-asar.mjs` — read inside the Electron `app.asar`

```powershell
node tools/probe-asar.mjs "<install>\resources\app.asar" list dsh-mcp-client 20
node tools/probe-asar.mjs "<install>\resources\app.asar" cat /dsh/node_modules/@deepseek-ai/dsh-mcp-client/package.json
node tools/probe-asar.mjs "<install>\resources\app.asar" grep /dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js saveImages
```

The asar container is an 8-byte-prefixed pickle header followed by concatenated
file payloads, with a JSON directory table in the middle of the file; this
locates that table by searching for `{"files"`, reads its length from the four
bytes before it, and computes the payload base offset from there. Useful when
you need to know which official packages a given Desktop build actually ships.

### `mcp-handshake.mjs` — talk to an MCP server without DSH

```powershell
node tools/mcp-handshake.mjs uvx windows-mcp serve --exclude-tools App,PowerShell,FileSystem
node tools/mcp-handshake.mjs python -m windows_mcp serve
```

Spawns the server over stdio and performs the real handshake —
`initialize` → `notifications/initialized` → `tools/list` → `resources/list` →
`resources/templates/list` → `prompts/list` — then prints tool names,
annotations, and the `Screenshot` input schema. It sets
`ANONYMIZED_TELEMETRY=false` and `WINDOWS_MCP_DISABLE_FLASH=1` for the child, and
gives each request a long timeout (900 s), because a cold `uvx` first run
downloads an entire Python environment before it answers.

This is the fastest way to tell "Windows-MCP is broken" apart from "the bridge
is misconfigured" when `windows_mcp_doctor` reports a missing tool set.
