#!/usr/bin/env node
// Guard against the install-time failure class: a git-installed Pi package has NO
// node_modules, so at runtime an extension can only resolve (a) relative paths,
// (b) node: builtins, and (c) the modules Pi's extension loader aliases. Of those,
// only `typebox` is aliased under a stable, unscoped specifier in every Pi
// distribution — the `@earendil-works/*` (and `@mariozechner/*`) specifiers are
// scope-fragile and fail to resolve on some installs.
//
// So: every VALUE import (type-only imports are erased and don't resolve at
// runtime) of a BARE specifier in extensions/ must be in the allowlist below.
// This is exactly what caught us shipping `import { StringEnum } from
// "@earendil-works/pi-ai"`.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(root, "extensions");

// Bare specifiers safe to value-import at runtime in any Pi install.
const ALLOWED_BARE = new Set(["typebox", "typebox/compile", "typebox/value"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const violations = [];
// Matches `import ... from "x"` and `import "x"`, capturing the leading keyword so
// we can skip `import type`. Side-effect imports (`import "x"`) are value imports.
const importRe = /^\s*import\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;

for (const file of walk(srcDir)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(importRe)) {
    const isType = Boolean(m[1]);
    const spec = m[2];
    if (isType) continue; // erased at runtime
    if (spec.startsWith(".") || spec.startsWith("node:")) continue; // relative / builtin
    if (ALLOWED_BARE.has(spec)) continue;
    violations.push({ file: path.relative(root, file), spec });
  }
}

if (violations.length > 0) {
  console.error("check-imports: FAIL — runtime value-imports of non-resolvable bare specifiers:");
  for (const v of violations) console.error(`  ${v.file}: import … from "${v.spec}"`);
  console.error(
    "\nA git-installed Pi package can't resolve these (no node_modules). Use `import type`\n" +
      "if it's types-only, or avoid the dependency. Allowed value-imports: " +
      [...ALLOWED_BARE].join(", ") +
      " (plus node: builtins and relative paths).",
  );
  process.exit(1);
}

console.log("check-imports: OK — no unresolvable runtime imports in extensions/");
