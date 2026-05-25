#!/usr/bin/env node
// Re-vendor the dependency-light @librarian/lifecycle primitives this extension
// reuses, straight from a sibling the-librarian checkout.
//
// WHY VENDOR (instead of an npm dependency): @librarian/lifecycle is a private,
// unpublished workspace package — a user installing this Pi package from git/npm
// cannot resolve it. The three modules we need (mcp-client, privacy, state) are
// LEAF modules: they import only Node built-ins and each other not at all, so
// copying the TypeScript source verbatim is clean (Pi compiles .ts in-process,
// so no build step is needed and types flow naturally).
//
// The COMMITTED vendor/*.ts are the distributable; run this after the upstream
// lifecycle changes. validate.mjs (run in CI) asserts each committed file still
// matches the recorded hash, so a hand-edit or stale copy fails the check.
//
// Set LIBRARIAN_MONOREPO to point at your the-librarian checkout if it is not the
// sibling directory.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const monorepo = process.env.LIBRARIAN_MONOREPO || path.resolve(root, "..", "the-librarian");
const srcDir = path.join(monorepo, "integrations", "shared", "librarian-lifecycle", "src");
const outDir = path.join(root, "extensions", "librarian", "vendor");

// The leaf modules we reuse. Keep this list minimal — every added module is more
// surface to keep in sync with upstream.
const MODULES = ["mcp-client.ts", "privacy.ts", "state.ts"];

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function tryExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const firstSrc = path.join(srcDir, MODULES[0]);
if (!existsSync(firstSrc)) {
  console.error(
    `@librarian/lifecycle source not found at:\n  ${srcDir}\n\n` +
      `Set LIBRARIAN_MONOREPO to your the-librarian checkout.`,
  );
  process.exit(1);
}

const lifecycleVersion = (() => {
  try {
    const pkg = path.join(monorepo, "integrations/shared/librarian-lifecycle/package.json");
    return JSON.parse(readFileSync(pkg, "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();
const monorepoSha = tryExec("git", ["-C", monorepo, "rev-parse", "HEAD"]);

const banner = (module) =>
  `// VENDORED from @librarian/lifecycle (src/${module}) — DO NOT EDIT BY HAND.\n` +
  `// Re-sync with: npm run vendor:sync. Drift is checked by scripts/validate.mjs.\n` +
  `// Provenance is recorded in ./PROVENANCE.json.\n\n`;

const files = {};
for (const module of MODULES) {
  const source = readFileSync(path.join(srcDir, module), "utf8");
  const vendored = banner(module) + source;
  writeFileSync(path.join(outDir, module), vendored);
  files[module] = { sourceSha256: sha256(source), vendoredSha256: sha256(vendored) };
  console.log(`vendored vendor/${module}`);
}

const provenance = {
  source: "@librarian/lifecycle",
  monorepoSha,
  lifecycleVersion,
  generatedBy: "scripts/vendor-sync.mjs",
  files,
};
writeFileSync(path.join(outDir, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(
  `wrote vendor/PROVENANCE.json (monorepo ${monorepoSha.slice(0, 12)}, lifecycle ${lifecycleVersion})`,
);
