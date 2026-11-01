/**
 * dsh-windows-mcp — PyPI mirror discovery (host side).
 *
 * Downloading `windows-mcp` from PyPI directly is unreliable on some networks
 * (measured on this project's own machine: the PyPI JSON API took 22 s and the
 * index page timed out, while mainland mirrors answered in ~100–500 ms). The
 * install and the version check therefore both run through this module:
 *
 *   1. **Probe.** For every mirror in `MIRROR_CANDIDATES`, fetch just
 *      `<index>/windows-mcp/` (≈10 KB — never the 47 MB root page) and download a
 *      ranged sample of a real wheel, timing both.
 *   2. **Rank.** Successful mirrors are ordered by measured throughput, index
 *      latency breaking ties. A hidden official fallback stays in the order
 *      list so a mirror that is fast now but fails mid-install still has a next
 *      address to try.
 *
 * Measured on this project's machine (2026-10, 256 KB sample): USTC ≈1.7 MB/s,
 * Tencent ≈1.4 MB/s, Aliyun ≈1.0 MB/s, Huawei ≈0.8 MB/s, NJU ≈0.6 MB/s; PyPI
 * itself timed out and TUNA answered 403 (IP-blocked for this network).
 *
 * Network access is injected (`options.fetchImpl`), so the whole module is
 * unit-testable without a socket, and every failure is reported as a value
 * instead of an exception.
 */
import { entryForVersion, latestStableEntry, latestStableVersion, parseIndex, projectIndexUrl } from "./pypi.js";

/** Mirrors this plugin knows about. `official` is always kept as last resort. */
export const MIRROR_CANDIDATES = Object.freeze([
  Object.freeze({ id: "pypi", label: "PyPI", indexUrl: "https://pypi.org/simple", official: true }),
  Object.freeze({ id: "ustc", label: "USTC 中科大", indexUrl: "https://mirrors.ustc.edu.cn/pypi/simple", official: false }),
  Object.freeze({ id: "aliyun", label: "阿里云", indexUrl: "https://mirrors.aliyun.com/pypi/simple", official: false }),
  Object.freeze({ id: "tencent", label: "腾讯云", indexUrl: "https://mirrors.cloud.tencent.com/pypi/simple", official: false }),
  Object.freeze({ id: "huawei", label: "华为云", indexUrl: "https://repo.huaweicloud.com/repository/pypi/simple", official: false }),
  Object.freeze({ id: "nju", label: "南京大学", indexUrl: "https://mirrors.nju.edu.cn/pypi/web/simple", official: false }),
  Object.freeze({ id: "tuna", label: "清华 TUNA", indexUrl: "https://pypi.tuna.tsinghua.edu.cn/simple", official: false }),
]);

/** Probe knobs: a small ranged read is enough to tell a fast mirror from a slow one. */
export const PROBE_DEFAULTS = Object.freeze({
  project: "windows-mcp",
  version: null,
  timeoutMs: 8000,
  sampleBytes: 96 * 1024,
  concurrency: 4,
  userAgent: "dsh-windows-mcp-index-probe",
});

/** No mirror describes itself in a way we can show; this is the fallback label. */
export function mirrorById(id, candidates = MIRROR_CANDIDATES) {
  return candidates.find((entry) => entry.id === id) ?? null;
}

/** Human line for the settings page: `USTC 中科大 · 1.7 MB/s`. */
export function describeMirror(result) {
  if (result === null || result === undefined) return "—";
  if (result.ok !== true) return `${result.label} · 不可用`;
  const speed = typeof result.speedBps === "number" ? result.speedBps : 0;
  return `${result.label} · ${formatBytesPerSecond(speed)}`;
}

/** Bytes per second → `1.7 MB/s` / `820 KB/s`. */
export function formatBytesPerSecond(bytesPerSecond) {
  const value = Number(bytesPerSecond);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(value / 1024))} KB/s`;
}

/** `fetch` with a hard timeout; rejects with a readable message. */
async function timedFetch(fetchImpl, url, init, timeoutMs) {
  const options = { ...init, signal: AbortSignal.timeout(timeoutMs) };
  try {
    return await fetchImpl(url, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} (${url})`);
  }
}

/** Probe one mirror: index latency, then a ranged wheel sample for throughput. */
async function probeMirror(mirror, settings) {
  const startedAt = Date.now();
  const base = {
    id: mirror.id,
    label: mirror.label,
    indexUrl: mirror.indexUrl,
    official: mirror.official === true,
  };
  try {
    const pageUrl = projectIndexUrl(mirror.indexUrl, settings.project);
    const page = await timedFetch(
      settings.fetchImpl,
      pageUrl,
      { headers: { accept: "text/html", "user-agent": settings.userAgent } },
      settings.timeoutMs,
    );
    const indexMs = Date.now() - startedAt;
    if (page?.ok !== true) throw new Error(`index answered HTTP ${page?.status ?? "?"}`);
    const html = typeof page.text === "function" ? await page.text() : "";
    const entries = parseIndex(html, pageUrl);
    if (entries.length === 0) throw new Error("the index lists no windows-mcp files");
    const wanted = settings.version === null || settings.version === undefined
      ? latestStableEntry(entries)
      : entryForVersion(entries, settings.version);
    if (wanted === null) throw new Error(`version ${settings.version} is not on this mirror`);
    const downloadStartedAt = Date.now();
    const sample = await timedFetch(
      settings.fetchImpl,
      wanted.url,
      {
        headers: {
          range: `bytes=0-${Math.max(0, settings.sampleBytes - 1)}`,
          "user-agent": settings.userAgent,
        },
      },
      settings.timeoutMs,
    );
    const status = sample?.status ?? 0;
    if (status !== 200 && status !== 206) throw new Error(`wheel sample answered HTTP ${status}`);
    const body = typeof sample.arrayBuffer === "function" ? new Uint8Array(await sample.arrayBuffer()) : new Uint8Array();
    const downloadMs = Math.max(1, Date.now() - downloadStartedAt);
    return {
      ...base,
      ok: true,
      indexMs,
      downloadMs,
      bytes: body.byteLength,
      speedBps: body.byteLength === 0 ? 0 : Math.round(body.byteLength / (downloadMs / 1000)),
      version: wanted.version,
      filename: wanted.filename,
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      indexMs: null,
      downloadMs: null,
      bytes: 0,
      speedBps: 0,
      version: null,
      filename: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Probe every candidate concurrently (bounded), then rank the survivors.
 * @returns `{ probedAt, results, ranked, best, project, version }`.
 */
export async function probeMirrors(options = {}) {
  const settings = {
    ...PROBE_DEFAULTS,
    ...options,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    candidates: Array.isArray(options.candidates) ? options.candidates : MIRROR_CANDIDATES,
  };
  if (typeof settings.fetchImpl !== "function") {
    return { probedAt: new Date().toISOString(), results: [], ranked: [], best: null, project: settings.project, version: settings.version, error: "no fetch implementation" };
  }
  const queue = settings.candidates.slice();
  const results = [];
  const workerCount = Math.max(1, Math.min(settings.concurrency, queue.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const mirror = queue.shift();
      if (mirror === undefined) return;
      results.push(await probeMirror(mirror, settings));
    }
  });
  await Promise.all(workers);
  const ranked = results
    .filter((result) => result.ok === true)
    .sort((left, right) => {
      if (right.speedBps !== left.speedBps) return right.speedBps - left.speedBps;
      return (left.indexMs ?? Number.MAX_SAFE_INTEGER) - (right.indexMs ?? Number.MAX_SAFE_INTEGER);
    });
  return {
    probedAt: new Date().toISOString(),
    results,
    ranked: ranked.map((result) => result.id),
    best: ranked[0] ?? null,
    project: settings.project,
    version: settings.version,
  };
}

/**
 * Read the full project index from one mirror: every file for every version.
 * @returns `{ indexUrl, pageUrl, entries, versions, latest }` — `versions` is
 *   newest-first and includes prereleases, `latest` is the newest stable one.
 */
export async function fetchProjectIndex(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const project = options.project ?? PROBE_DEFAULTS.project;
  const indexUrl = options.indexUrl;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : PROBE_DEFAULTS.timeoutMs;
  const userAgent = options.userAgent ?? PROBE_DEFAULTS.userAgent;
  const pageUrl = projectIndexUrl(indexUrl, project);
  const response = await timedFetch(fetchImpl, pageUrl, { headers: { accept: "text/html", "user-agent": userAgent } }, timeoutMs);
  if (response?.ok !== true) throw new Error(`${indexUrl} answered HTTP ${response?.status ?? "?"}`);
  const entries = parseIndex(typeof response.text === "function" ? await response.text() : "", pageUrl);
  const versions = [...new Set(entries.map((entry) => entry.version))];
  return { indexUrl, pageUrl, entries, versions, latest: latestStableVersion(versions) };
}

/** Candidate mirrors in probe order, honouring a user preference. */
export function mirrorCandidates(preferred = "auto", candidates = MIRROR_CANDIDATES) {
  const wanted = mirrorById(preferred, candidates);
  if (wanted === null) return candidates.slice();
  return [wanted].concat(candidates.filter((mirror) => mirror.id !== wanted.id));
}

/** Mirrors in the order an install should try them: ranked first, official last. */
export function mirrorOrder(probe, candidates = MIRROR_CANDIDATES) {
  const seen = new Set();
  const order = [];
  for (const id of Array.isArray(probe?.ranked) ? probe.ranked : []) {
    const mirror = mirrorById(id, candidates);
    if (mirror !== null && !seen.has(mirror.id)) {
      seen.add(mirror.id);
      order.push(mirror);
    }
  }
  for (const mirror of candidates) {
    if (mirror.official === true && !seen.has(mirror.id)) {
      seen.add(mirror.id);
      order.push(mirror);
    }
  }
  for (const mirror of candidates) {
    if (!seen.has(mirror.id)) {
      seen.add(mirror.id);
      order.push(mirror);
    }
  }
  return order;
}

/** The mirror an install should try first, or null when nothing was probed. */
export function preferredMirror(probe, candidates = MIRROR_CANDIDATES) {
  return mirrorOrder(probe, candidates)[0] ?? null;
}
