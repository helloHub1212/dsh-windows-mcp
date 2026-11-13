/**
 * Tests for the process scan the installer uses before it touches a tool
 * environment.
 *
 * The interesting parts are pure: reading `pid|path` lines, deciding whether a
 * path lives under the version root, and settling instead of hanging. The
 * Windows-only launcher is exercised through an injected fake.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { listProcesses, parseProcessLines, processesUnder } from "../lib/processes.js";

test("the process parser keeps the paths that the scanner printed", () => {
  const entries = parseProcessLines(
    "4321|C:\\Users\\me\\.dsh\\dsh-windows-mcp\\toolchain\\0.8.8\\windows-mcp\\Scripts\\windows-mcp.exe\r\n" +
      "77|C:\\Windows\\explorer.exe\r\n" +
      "not a process\r\n" +
      "0|C:\\broken.exe\r\n",
  );
  assert.deepEqual(entries, [
    { pid: 4321, path: "C:\\Users\\me\\.dsh\\dsh-windows-mcp\\toolchain\\0.8.8\\windows-mcp\\Scripts\\windows-mcp.exe" },
    { pid: 77, path: "C:\\Windows\\explorer.exe" },
  ]);
  assert.deepEqual(parseProcessLines(""), []);
});

test("the process filter only matches files inside the version root", () => {
  const root = "C:\\Users\\me\\.dsh\\dsh-windows-mcp\\toolchain\\0.8.8";
  const entries = [
    { pid: 1, path: `${root}\\windows-mcp\\Scripts\\windows-mcp.exe` },
    { pid: 2, path: root },
    { pid: 3, path: `${root}-extra\\windows-mcp\\Scripts\\windows-mcp.exe` },
    { pid: 4, path: "C:\\Windows\\explorer.exe" },
  ];
  assert.deepEqual(
    processesUnder(root, entries).map((entry) => entry.pid),
    [1, 2],
    "a sibling folder that only shares the prefix is not part of the install",
  );
  assert.deepEqual(processesUnder(root, []), []);
  assert.deepEqual(processesUnder("", entries), []);
});

test("the process scan reports nothing on a host that is not Windows", async () => {
  assert.deepEqual(await listProcesses({ platform: "linux", spawn: () => assert.fail("no spawn expected") }), []);
  assert.deepEqual(await listProcesses({ platform: "darwin" }), []);
});

test("the process scan reads the launcher output and settles on a timeout", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.kill = () => {};
  const spawned = listProcesses({
    platform: "win32",
    timeoutMs: 5000,
    spawn: () => {
      setImmediate(() => {
        child.stdout.emit("data", "1234|C:\\tools\\windows-mcp\\Scripts\\windows-mcp.exe\n");
        child.emit("close", 0);
      });
      return child;
    },
  });
  assert.deepEqual(await spawned, [{ pid: 1234, path: "C:\\tools\\windows-mcp\\Scripts\\windows-mcp.exe" }]);

  const stuck = new EventEmitter();
  stuck.stdout = new EventEmitter();
  stuck.stderr = new EventEmitter();
  stuck.kill = () => {};
  const timedOut = listProcesses({ platform: "win32", timeoutMs: 20, spawn: () => stuck });
  assert.deepEqual(
    await timedOut,
    [],
    "a scan that hangs must not hold the install up: the caller then lets uv report the real failure",
  );
});
