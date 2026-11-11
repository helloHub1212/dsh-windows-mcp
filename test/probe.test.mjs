/**
 * Tests for the live desktop probe behind `windows_mcp_doctor`.
 *
 * The probe ships a fixed PowerShell program, so everything worth testing here
 * is the pure boundary: reading the measurement line, wording the diagnosis,
 * and settling on a timeout instead of hanging a tool call.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { describeProbe, parseProbeOutput, probeDesktop } from "../lib/desktop-probe.js";

test("the probe output parser reads the measurement line after console noise", () => {
  const parsed = parseProbeOutput('Add-Type: some warning\r\n{"uia":13,"windows":14,"scale":1}\r\n');
  assert.deepEqual(parsed, { uiaWindows: 13, windowHandles: 14, displayScale: 1 });
  assert.deepEqual(parseProbeOutput('{"uia":1,"windows":13,"scale":2.5}'), {
    uiaWindows: 1,
    windowHandles: 13,
    displayScale: 2.5,
  });
});

test("the probe output parser treats -1 as 'not measurable' and rejects junk", () => {
  assert.deepEqual(parseProbeOutput('{"uia":-1,"windows":-1,"scale":-1}'), {
    uiaWindows: null,
    windowHandles: null,
    displayScale: null,
  });
  assert.equal(parseProbeOutput(""), null);
  assert.equal(parseProbeOutput("powershell is not recognized"), null);
  assert.equal(parseProbeOutput('{"uia":"many"}'), null);
});

test("an empty UI Automation tree is attributed to the upstream report, not to the install", () => {
  const reported = describeProbe({ uiaWindows: 1, windowHandles: 13, displayScale: 1 });
  assert.match(reported.line, /UI Automation sees 1 top-level window/);
  assert.match(reported.line, /13 window handle/);
  assert.equal(reported.notes.length, 1);
  assert.match(reported.notes[0], /CursorTouch\/Windows-MCP\/issues\/607/u);
  assert.match(reported.notes[0], /not an install, mirror, or sandbox problem/u);
});

test("a high display scale gets its own note about drifted coordinates", () => {
  const reported = describeProbe({ uiaWindows: 12, windowHandles: 13, displayScale: 2.5 });
  assert.equal(reported.notes.length, 1, "healthy UIA raises nothing by itself");
  assert.match(reported.notes[0], /250% scaling/u);
  assert.match(reported.notes[0], /divides absolute Move\/Click coordinates/u);

  const both = describeProbe({ uiaWindows: 1, windowHandles: 13, displayScale: 2.5 });
  assert.equal(both.notes.length, 2, "the two upstream symptoms are independent");
});

test("a healthy session produces measurements but no upstream note", () => {
  const reported = describeProbe({ uiaWindows: 13, windowHandles: 14, displayScale: 1 });
  assert.equal(reported.notes.length, 0);
  assert.match(reported.line, /display scale 100%/u);
});

test("a probe that did not run says so without guessing", () => {
  assert.equal(describeProbe(null).line, "not measured");
  assert.match(describeProbe({ error: "powershell exited with code 1" }).line, /not measured \(powershell exited/u);
  assert.match(describeProbe({ skipped: "not a Windows host" }).line, /not measured \(not a Windows host\)/u);
  assert.deepEqual(describeProbe({ error: "boom" }).notes, []);
});

test("probeDesktop settles on the timeout instead of hanging a tool call", async () => {
  const fakeChild = {
    stdout: { setEncoding() {}, on() {} },
    stderr: { setEncoding() {}, on() {} },
    on() {},
    kill() {},
  };
  const probe = await probeDesktop({ timeoutMs: 20, spawn: () => fakeChild });
  assert.match(String(probe.error), /timed out after 20 ms/u);
});

test("probeDesktop resolves measurements from the child's stdout", async () => {
  const handlers = {};
  const fakeChild = {
    stdout: {
      setEncoding() {},
      on(event, callback) {
        handlers[`out:${event}`] = callback;
      },
    },
    stderr: {
      setEncoding() {},
      on(event, callback) {
        handlers[`err:${event}`] = callback;
      },
    },
    on(event, callback) {
      handlers[event] = callback;
    },
    kill() {},
  };
  const pending = probeDesktop({ timeoutMs: 2000, spawn: () => fakeChild });
  handlers["out:data"]?.('{"uia":13,"windows":14,"scale":1}');
  handlers.close?.(0);
  assert.deepEqual(await pending, { uiaWindows: 13, windowHandles: 14, displayScale: 1 });
});
