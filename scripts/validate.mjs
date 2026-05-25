#!/usr/bin/env node
// Drift check for the vendored @librarian/lifecycle primitives.
//
// Asserts every committed vendor/*.ts still matches the sha256 recorded in
// vendor/PROVENANCE.json. A hand-edit, corruption, or stale copy fails here, so
// the vendored code can only change through scripts/vendor-sync.mjs (which
// re-stamps the provenance). Run in CI.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vendorDir = path.join(root, "extensions", "librarian", "vendor");
const provenancePath = path.join(vendorDir, "PROVENANCE.json");

function fail(message) {
  console.error(`validate: ${message}`);
  process.exit(1);
}

if (!existsSync(provenancePath)) fail("vendor/PROVENANCE.json is missing — run npm run vendor:sync");

let provenance;
try {
  provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
} catch (err) {
  fail(`vendor/PROVENANCE.json is not valid JSON: ${err.message}`);
}

const files = provenance.files ?? {};
const names = Object.keys(files);
if (names.length === 0) fail("vendor/PROVENANCE.json records no files");

let ok = 0;
for (const name of names) {
  const file = path.join(vendorDir, name);
  if (!existsSync(file)) fail(`vendored file vendor/${name} is missing`);
  const actual = createHash("sha256").update(readFileSync(file, "utf8")).digest("hex");
  const expected = files[name].vendoredSha256;
  if (actual !== expected) {
    fail(
      `vendor/${name} has drifted from PROVENANCE.json\n` +
        `  expected ${expected}\n  actual   ${actual}\n` +
        `  re-run npm run vendor:sync (and review the diff) to update it.`,
    );
  }
  ok += 1;
}

console.log(
  `validate: ${ok} vendored file(s) match PROVENANCE.json ` +
    `(lifecycle ${provenance.lifecycleVersion ?? "unknown"}, monorepo ${String(
      provenance.monorepoSha ?? "unknown",
    ).slice(0, 12)})`,
);
