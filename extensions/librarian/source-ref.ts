// source_ref derivation for Pi (spec §5.2 + the Pi AGENTS.md contract).
//
// The Librarian uses `source_ref` for attribution and `cwd` as the resume match
// key. A coding harness resumes by DIRECTORY, so the cwd is what links a fresh
// Pi process to the session it left behind — `source_ref` is attribution only.

export interface SourceRefInput {
  /** Absolute working directory — always available from ctx.cwd. */
  cwd: string;
  /** Pi's own session id/name, when the runtime exposes one. */
  piSessionId?: string | undefined;
  /** A device id for multi-device Pi deployments (env PI_DEVICE_ID). */
  deviceId?: string | undefined;
}

/**
 * Build the most specific `source_ref` Pi can offer, in descending specificity:
 *   pi:device:{device}:session:{session}  → device + session known
 *   pi:device:{device}                     → device only
 *   pi:session:{session}                   → session only (typical coding-agent)
 *   cwd:{cwd}                              → nothing else available
 */
export function derivePiSourceRef(input: SourceRefInput): string {
  const device = input.deviceId?.trim();
  const session = input.piSessionId?.trim();
  if (device && session) return `pi:device:${device}:session:${session}`;
  if (device) return `pi:device:${device}`;
  if (session) return `pi:session:${session}`;
  return `cwd:${input.cwd}`;
}
