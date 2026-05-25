// Environment-driven configuration for the Pi ↔ Librarian integration.
//
// The extension stays DORMANT unless a remote Librarian is configured
// (LIBRARIAN_MCP_URL + LIBRARIAN_AGENT_TOKEN). This mirrors the other harness
// packages: no endpoint/token → no automatic calls, no surprises.

import fs from "node:fs";
import path from "node:path";
import type { StateLocation } from "./vendor/state.js";
import type { CaptureMode } from "./session-client.js";

export const HARNESS = "pi" as const;

export interface LibrarianConfig {
  endpoint: string;
  token: string;
  timeoutMs?: number | undefined;
  projectKey?: string | undefined;
  deviceId?: string | undefined;
  captureMode: CaptureMode;
  /** Override the local-state root (tests). Defaults to ~/.librarian/harness-state. */
  stateBaseDir?: string | undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseCaptureMode(value: string | undefined): CaptureMode {
  // Conservative default; `log` is never auto-enabled (operator-only).
  return value === "off" || value === "log" ? value : "summary";
}

/**
 * Read config from the environment. Returns null when the remote Librarian is
 * not configured — the caller treats that as "extension dormant".
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): LibrarianConfig | null {
  const endpoint = env.LIBRARIAN_MCP_URL?.trim();
  const token = env.LIBRARIAN_AGENT_TOKEN?.trim();
  if (!endpoint || !token) return null;

  const config: LibrarianConfig = {
    endpoint,
    token,
    captureMode: parseCaptureMode(env.LIBRARIAN_CAPTURE_MODE),
  };
  const timeoutMs = parsePositiveInt(env.LIBRARIAN_TIMEOUT_MS);
  if (timeoutMs !== undefined) config.timeoutMs = timeoutMs;
  const projectKey = env.LIBRARIAN_PROJECT_KEY?.trim() || env.LIBRARIAN_PROJECT?.trim();
  if (projectKey) config.projectKey = projectKey;
  const deviceId = env.PI_DEVICE_ID?.trim();
  if (deviceId) config.deviceId = deviceId;
  return config;
}

/**
 * Infer a project key from the working directory: the git repository name (the
 * basename of the directory that holds `.git`) if inside a repo, else the folder
 * name. This spares users an env var for the common case; `LIBRARIAN_PROJECT`
 * still overrides it. Returns undefined only for a root/empty path.
 */
export function inferProjectKey(cwd: string): string | undefined {
  let dir = cwd;
  for (;;) {
    // `.git` is a dir in a normal clone and a file in a worktree/submodule —
    // existsSync matches both.
    if (fs.existsSync(path.join(dir, ".git"))) return path.basename(dir) || undefined;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return path.basename(cwd) || undefined;
}

/**
 * Build the local-state location. Keyed by cwd (a coding harness resumes by
 * directory, §5.2), so a fresh Pi process in the same directory finds the state
 * — and thus the Librarian session — it left behind. `sourceRef` is intentionally
 * NOT part of the location: including a per-session value would change the state
 * file path every run and defeat cwd-based resume.
 */
export function buildStateLocation(cwd: string, projectKey?: string | undefined): StateLocation {
  const location: StateLocation = {
    harness: HARNESS,
    harnessSessionKey: cwd,
    cwd,
  };
  if (projectKey) location.projectKey = projectKey;
  return location;
}
