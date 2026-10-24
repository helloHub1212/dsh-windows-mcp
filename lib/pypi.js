/**
 * dsh-windows-mcp — PyPI index parsing and version maths (host side).
 *
 * The upstream program (`windows-mcp`) is published on PyPI, so the plugin needs
 * two things that look like string processing but must be exactly right:
 *
 *   1. **Which versions exist, and which is the newest stable one?** — a PEP 503
 *      `/simple/<project>/` page is plain HTML; this module parses it instead of
 *      the JSON API, because some mirrors do not serve the JSON API at all and
 *      the simple page is the one file every mirror does serve.
 *   2. **Is 0.9.0 newer than 0.8.10?** — no `semver` dependency here, so the
 *      comparison is written down once and tested: numeric component-wise, with
 *      a stable release sorting above a pre-release of the same core.
 *
 * Everything is pure: no I/O, no network, no throwing. A malformed page simply
 * yields fewer entries.
 */

/** Path of the project's index on a mirror, e.g. `https://…/simple/windows-mcp/`. */
export function projectIndexUrl(indexUrl, project) {
  return `${String(indexUrl ?? "").replace(/\/+$/u, "")}/${String(project ?? "").replace(/^\/+/u, "")}/`;
}

/**
 * Numeric core of a version plus whatever trails it.
 * @returns `{ parts: number[], rest: string }` or null.
 */
export function versionParts(version) {
  const match = /^v?(\d+(?:\.\d+)*)(.*)$/u.exec(String(version ?? "").trim());
  if (match === null) return null;
  const parts = match[1].split(".").map((piece) => Number.parseInt(piece, 10));
  if (parts.some((piece) => !Number.isFinite(piece))) return null;
  return { parts, rest: match[2].trim() };
}

/** A release without a pre-release/dev/post marker: `0.8.8`, not `0.9.0rc1`. */
export function isStableVersion(version) {
  return /^\d+(?:\.\d+)*$/u.test(String(version ?? "").trim());
}

/**
 * Compare two versions: -1, 0 or 1. Non-numeric strings fall back to a plain
 * string compare so the caller still gets a total order.
 */
export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (a === null || b === null) {
    const x = String(left ?? "");
    const y = String(right ?? "");
    if (x === y) return 0;
    return x < y ? -1 : 1;
  }
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.parts[index] ?? 0;
    const y = b.parts[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  // Same numeric core: a bare release beats a pre-release (`0.9.0` > `0.9.0rc1`).
  const ax = a.rest === "" ? 1 : 0;
  const bx = b.rest === "" ? 1 : 0;
  if (ax === bx) return 0;
  return ax < bx ? -1 : 1;
}

/** The newest stable version of a list of versions, or null. */
export function latestStableVersion(versions) {
  let best = null;
  for (const version of Array.isArray(versions) ? versions : []) {
    if (typeof version !== "string" || !isStableVersion(version)) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best;
}

/**
 * The upstream version a PyPI filename refers to, or null.
 * Handles wheels (`windows_mcp-0.8.8-py3-none-any.whl`) and sdists
 * (`windows_mcp-0.8.8.tar.gz`); the distribution name must be this project's.
 */
export function versionFromFilename(filename, project = "windows-mcp") {
  let clean;
  try {
    clean = decodeURIComponent(String(filename ?? "").replace(/^.*\//u, ""));
  } catch {
    clean = String(filename ?? "").replace(/^.*\//u, "");
  }
  if (clean === "") return null;
  const distribution = String(project ?? "windows-mcp").replace(/-/gu, "[_-]");
  const name = new RegExp(`^${distribution}$`, "iu");
  const lower = clean.toLowerCase();
  if (lower.endsWith(".whl")) {
    const parts = clean.slice(0, -".whl".length).split("-");
    if (parts.length < 2 || !name.test(parts[0])) return null;
    return parts[1] === "" ? null : parts[1];
  }
  if (lower.endsWith(".tar.gz")) {
    const parts = clean.slice(0, -".tar.gz".length).split("-");
    if (parts.length < 2) return null;
    if (!name.test(parts.slice(0, -1).join("-"))) return null;
    return parts[parts.length - 1] === "" ? null : parts[parts.length - 1];
  }
  return null;
}

/**
 * Parse a PEP 503 simple index page into entries, newest first.
 * @param html - page body.
 * @param pageUrl - absolute URL the page was served from (relative hrefs resolve against it).
 * @returns `[{ filename, version, url, stable, yanked }]`.
 */
export function parseIndex(html, pageUrl) {
  const entries = [];
  const anchor = /<a\b[^>]*>/giu;
  const body = String(html ?? "");
  let match;
  while ((match = anchor.exec(body)) !== null) {
    const tag = match[0];
    const href = /href\s*=\s*"([^"]+)"/iu.exec(tag);
    if (href === null) continue;
    const target = String(href[1]);
    // PEP 503 links may carry a `#sha256=…` fragment (and occasionally a query);
    // the *file name* is the path's last segment, never the fragment.
    const rawPath = target.split("#")[0].split("?")[0];
    let filename = rawPath.replace(/^.*\//u, "");
    try {
      filename = decodeURIComponent(filename);
    } catch {
      /* keep it percent-encoded then */
    }
    const version = versionFromFilename(filename);
    if (version === null) continue;
    let url = target;
    try {
      url = new URL(target, pageUrl).href;
    } catch {
      /* keep the raw href; the caller reports a failure */
    }
    entries.push({
      filename,
      version,
      url,
      stable: isStableVersion(version),
      yanked: /data-yanked\s*=/iu.test(tag),
    });
  }
  return entries.sort((left, right) => compareVersions(right.version, left.version));
}

/** Newest stable entry of a parsed index, or null. */
export function latestStableEntry(entries) {
  let best = null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.stable !== true || entry?.yanked === true) continue;
    if (best === null || compareVersions(entry.version, best.version) > 0) best = entry;
  }
  return best;
}

/** A wheel for `version` if the index has one, else the sdist, else any entry. */
export function entryForVersion(entries, version) {
  if (!Array.isArray(entries)) return null;
  const matching = entries.filter((entry) => entry?.version === version && entry?.yanked !== true);
  if (matching.length === 0) return null;
  return (
    matching.find((entry) => entry.filename.toLowerCase().endsWith(".whl")) ??
    matching.find((entry) => entry.filename.toLowerCase().endsWith(".tar.gz")) ??
    matching[0]
  );
}
