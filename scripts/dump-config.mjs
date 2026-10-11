/**
 * Development helper: compose this plugin's patch layer on top of a real DSH
 * profile and print the resulting config tree, without touching that profile
 * and without restarting DSH.
 *
 * Usage:
 *   node scripts/dump-config.mjs [profile] [--out <file>]
 *
 * `profile` defaults to `dtest`, a scratch profile that must already exist.
 * Create one by copying an existing profile's `package.json` and junctioning
 * its `node_modules`:
 *
 *   mkdir %USERPROFILE%\.dsh\profiles\dtest
 *   copy  %USERPROFILE%\.dsh\profiles\desktop\package.json %USERPROFILE%\.dsh\profiles\dtest\
 *   cmd /c mklink /J %USERPROFILE%\.dsh\profiles\dtest\node_modules %USERPROFILE%\.dsh\profiles\desktop\node_modules
 *
 * Why a scratch profile: the Electron app owns the `desktop` profile and the
 * CLI refuses every command against it, including read-only dumps.
 *
 * The DSH CLI is located from `$DSH_CLI`, or from the default Desktop install.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const patch = join(packageRoot, "cordis.patch.yml");

const argv = process.argv.slice(2);
const profile = argv.find((value) => !value.startsWith("--")) ?? "dtest";
const outIndex = argv.indexOf("--out");
const outFile = outIndex >= 0 ? argv[outIndex + 1] : null;

const candidates = [
  process.env.DSH_CLI,
  join(process.env.LOCALAPPDATA ?? "", "Programs", "DeepSeek Harness", "resources", "runtime", "cli", "bin", "dsh.cmd"),
].filter(Boolean);

const cli = candidates.find((candidate) => existsSync(candidate));
if (cli === undefined) {
  console.error("dsh CLI not found. Set DSH_CLI to the bundled dsh.cmd path.");
  process.exit(1);
}

console.log(`cli     : ${cli}`);
console.log(`profile : ${profile}`);
console.log(`patch   : ${patch}`);

const result = spawnSync(
  // A single quoted command line: `spawnSync(cli, args, { shell: true })` hands
  // cmd.exe an unquoted argv, which breaks on the default install path
  // ("C:\Users\...\DeepSeek Harness\..."). Quoting here keeps spaces intact.
  `"${cli}" --profile "${profile}" --dump-config --patch "${patch}"`,
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (outFile !== null && result.stdout) {
  writeFileSync(outFile, result.stdout);
  console.log(`written : ${outFile}`);
}

if (result.status !== 0) {
  console.error(`\ndsh exited with status ${result.status}. If it complained about a managed profile, use a scratch profile instead of "desktop".`);
}
process.exit(result.status ?? 1);
