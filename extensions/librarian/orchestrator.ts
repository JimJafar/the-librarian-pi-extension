// Async session-lifecycle orchestration for Pi (ports @librarian/lifecycle's
// session.ts decisions to a long-lived, in-process, async runtime).
//
// Why a re-implementation rather than reusing session.ts directly: that helper is
// synchronous end-to-end (it drives the Librarian via spawnSync of the `mcp-call`
// bin — correct for a short-lived hook PROCESS). Pi is the opposite: one
// long-lived process whose event loop must never block on network I/O. So here
// the Librarian calls are async, and serialization is an in-memory mutex rather
// than the cross-process file lock — sufficient because a Pi process owns its cwd.
//
// The privacy contract is preserved verbatim from the spec:
//   - FAIL CLOSED on state I/O errors: make no automatic Librarian call (§9).
//   - enter-private always means private; ending the attached session (§3.3, §4.3).
//   - NEVER auto-end on a guess — the only automatic end is public→private (§5.4).

import {
  type PrivacyMarkers,
  detectPrivacySignal,
} from "./lifecycle/privacy.js";
import {
  type HarnessLibrarianState,
  type StateLocation,
  type StateOptions,
  STATE_VERSION,
  StateIoError,
  StateLockError,
  loadState,
  saveState,
} from "./lifecycle/state.js";
import { McpClientError } from "./lifecycle/mcp-client.js";
import {
  type CaptureMode,
  type ParsedSession,
  type SessionClient,
  type Visibility,
  NoSessionError,
} from "./session-client.js";

export type { ParsedSession };

const PRIVATE_END_REASON = "switching to private mode";
const DEFAULT_START_SUMMARY = "Session started by the Pi lifecycle extension.";
const DEFAULT_PAUSE_SUMMARY = "Session paused (Pi exit or idle).";
const DEFAULT_CHECKPOINT_SUMMARY = "Checkpoint by the Pi lifecycle extension.";

export interface CheckpointThresholds {
  minIntervalMinutes: number;
  minFilesTouched: number;
  minToolCalls: number;
  onCompaction: boolean;
  onTaskCompleted: boolean;
}

export const DEFAULT_CHECKPOINT_THRESHOLDS: CheckpointThresholds = {
  minIntervalMinutes: 30,
  minFilesTouched: 2,
  minToolCalls: 5,
  onCompaction: true,
  onTaskCompleted: true,
};

export type Privacy = "public" | "private";

export interface LifecycleLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  error?: unknown;
}

export interface OrchestratorDeps {
  client: SessionClient;
  location: StateLocation;
  sourceRef: string;
  captureMode: CaptureMode;
  projectKey?: string | undefined;
  checkpoint?: Partial<CheckpointThresholds> | undefined;
  privacyMarkers?: PrivacyMarkers | undefined;
  stateOptions?: StateOptions | undefined;
  now?: (() => number) | undefined;
  logger?: ((entry: LifecycleLogEntry) => void) | undefined;
}

export type PromptAction =
  | "suppressed-error"
  | "suppressed-private"
  | "entered-private"
  | "exited-private"
  | "toggled-public"
  | "ignored"
  | "started"
  | "resumed"
  | "active"
  | "error";

export interface PromptOutcome {
  action: PromptAction;
  privacy: Privacy;
  sessionId?: string;
}

export interface CheckpointInput {
  trigger?: "compaction" | "task-completed" | "activity";
  filesTouched?: number;
  toolCalls?: number;
  summary?: string;
}

export type CheckpointAction =
  | "suppressed-error"
  | "suppressed-private"
  | "no-session"
  | "skipped-gate"
  | "checkpointed"
  | "error";

export interface CheckpointOutcome {
  action: CheckpointAction;
  sessionId?: string;
}

export type PauseAction =
  | "suppressed-error"
  | "suppressed-private"
  | "no-session"
  | "paused"
  | "error";

export interface ExplicitStartArgs {
  title?: string | undefined;
  /** Start the session with agent_private VISIBILITY (still recorded). */
  private?: boolean | undefined;
  summary?: string | undefined;
}

export interface Orchestrator {
  /** Privacy gate + idempotent auto start/resume. Driven by the `input` event. */
  handlePrompt(text: string): Promise<PromptOutcome>;
  /** Gated checkpoint. Driven by agent_end (activity) and session_compact. */
  handleCheckpoint(input?: CheckpointInput): Promise<CheckpointOutcome>;
  /** Pause (never end) on Pi shutdown. */
  handlePause(summary?: string): Promise<PauseAction>;
  /** Explicit off-record toggle (the /lib-toggle-private command). */
  toggle(): Promise<PromptOutcome>;
  /** Explicit /lib-session-start. */
  startExplicit(args?: ExplicitStartArgs): Promise<ParsedSession>;
  list(includeEnded?: boolean): Promise<ParsedSession[]>;
  resume(sessionId: string): Promise<string>;
  checkpointExplicit(summary: string): Promise<CheckpointOutcome>;
  pauseExplicit(summary: string): Promise<PauseAction>;
  endExplicit(summary?: string): Promise<void>;
  search(query: string, limit?: number): Promise<string>;
  /** Current local view: attached session id + off-record flag. */
  status(): { sessionId?: string; privacy: Privacy };
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { client, location } = deps;
  const stateOptions = deps.stateOptions ?? {};
  const now = deps.now ?? Date.now;
  const log = deps.logger ?? (() => {});
  const thresholds: CheckpointThresholds = {
    ...DEFAULT_CHECKPOINT_THRESHOLDS,
    ...deps.checkpoint,
  };

  // In-memory serialization. Unlike a cross-process file lock, this tolerates
  // awaits, so a whole find-or-create (including the network round-trip) runs as
  // one critical section — no off-record prompt can slip a session in mid-flight.
  let chain: Promise<unknown> = Promise.resolve();
  function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = chain.then(fn, fn);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function nowIso(): string {
    return new Date(now()).toISOString();
  }

  function composeState(
    privacy: Privacy,
    fields: {
      librarianSessionId?: string | undefined;
      enteredPrivateAt?: string | undefined;
      lastActivityAt?: string | undefined;
      lastCheckpointAt?: string | undefined;
    },
  ): HarnessLibrarianState {
    const state: HarnessLibrarianState = {
      version: STATE_VERSION,
      harness: location.harness,
      harness_session_key: location.harnessSessionKey,
      privacy,
    };
    // Keep persisted fields in lockstep with the location (no source_ref — see
    // buildStateLocation) so loadState and saveState resolve the same file.
    if (location.cwd !== undefined) state.cwd = location.cwd;
    if (location.projectKey !== undefined) state.project_key = location.projectKey;
    if (fields.librarianSessionId !== undefined)
      state.librarian_session_id = fields.librarianSessionId;
    if (fields.enteredPrivateAt !== undefined) state.entered_private_at = fields.enteredPrivateAt;
    if (fields.lastActivityAt !== undefined) state.last_activity_at = fields.lastActivityAt;
    if (fields.lastCheckpointAt !== undefined) state.last_checkpoint_at = fields.lastCheckpointAt;
    return state;
  }

  function read(): HarnessLibrarianState | null {
    return loadState(location, stateOptions);
  }
  function write(state: HarnessLibrarianState): void {
    saveState(state, stateOptions);
  }

  function isStateError(err: unknown): boolean {
    return err instanceof StateIoError || err instanceof StateLockError;
  }

  function logCliError(context: string, err: unknown): void {
    const kind = err instanceof McpClientError ? err.kind : err instanceof NoSessionError ? "not-found" : "unknown";
    log({ level: "warn", message: `librarian: ${context} failed (${kind})`, error: err });
  }

  async function resolveSession(): Promise<{ session: { id: string }; action: "started" | "resumed" }> {
    // Resume only on an unambiguous single match (we are unattended); otherwise
    // start fresh rather than guess (§5.2).
    const matches = await client.list({
      harness: location.harness,
      statuses: ["active", "paused"],
      ...(location.cwd !== undefined ? { cwd: location.cwd } : {}),
      ...(location.projectKey !== undefined ? { projectKey: location.projectKey } : {}),
    });
    if (matches.length === 1) {
      const id = matches[0]!.id;
      await client.continue(id, {
        targetHarness: location.harness,
        ...(location.cwd !== undefined ? { targetCwd: location.cwd } : {}),
        targetSourceRef: deps.sourceRef,
      });
      return { session: { id }, action: "resumed" };
    }
    const session = await client.start({
      harness: location.harness,
      sourceRef: deps.sourceRef,
      ...(location.cwd !== undefined ? { cwd: location.cwd } : {}),
      ...(location.projectKey !== undefined ? { projectKey: location.projectKey } : {}),
      summary: DEFAULT_START_SUMMARY,
      captureMode: deps.captureMode,
    });
    return { session: { id: session.id }, action: "started" };
  }

  // End the attached public session with a neutral reason on the private
  // transition (§4.3). A failure here is logged loudly but never thrown: local
  // state has already gone private, so no further automatic call is made.
  async function endAttached(attachedId: string | undefined): Promise<void> {
    if (!attachedId) return;
    try {
      await client.end(attachedId, PRIVATE_END_REASON);
    } catch (err) {
      log({
        level: "error",
        message: `librarian: failed to end session ${attachedId} on private transition; it may linger active`,
        error: err,
      });
    }
  }

  return {
    handlePrompt(text) {
      return runExclusive<PromptOutcome>(async () => {
        let state: HarnessLibrarianState | null;
        try {
          state = read();
        } catch (err) {
          if (isStateError(err)) {
            log({ level: "error", message: "librarian: state unavailable, failing closed", error: err });
            return { action: "suppressed-error", privacy: "private" };
          }
          throw err;
        }
        const isPrivate = state?.privacy === "private";

        const { signal } = detectPrivacySignal(text, deps.privacyMarkers ?? {});
        // The explicit toggle command owns toggles; don't double-handle it here.
        if (signal === "toggle") {
          return { action: "ignored", privacy: isPrivate ? "private" : "public" };
        }
        if (signal === "enter-private") {
          try {
            write(composeState("private", { enteredPrivateAt: nowIso() }));
          } catch (err) {
            if (isStateError(err)) {
              await endAttached(state?.librarian_session_id);
              return { action: "suppressed-error", privacy: "private" };
            }
            throw err;
          }
          await endAttached(state?.librarian_session_id);
          return { action: "entered-private", privacy: "private" };
        }
        if (signal === "exit-private") {
          // Flip to public but do NOT record this prompt; the prior session was
          // ended on entry, so the next prompt starts fresh (§3.3).
          try {
            write(composeState("public", {}));
          } catch (err) {
            if (isStateError(err)) return { action: "suppressed-error", privacy: "private" };
            throw err;
          }
          return { action: "exited-private", privacy: "public" };
        }

        // No marker. While off-record, make no call at all (§9).
        if (isPrivate) return { action: "suppressed-private", privacy: "private" };

        // Already attached → just refresh activity.
        if (state?.librarian_session_id) {
          const id = state.librarian_session_id;
          try {
            write(
              composeState("public", {
                librarianSessionId: id,
                lastActivityAt: nowIso(),
                lastCheckpointAt: state.last_checkpoint_at,
              }),
            );
          } catch (err) {
            if (isStateError(err)) return { action: "suppressed-error", privacy: "private" };
            throw err;
          }
          return { action: "active", privacy: "public", sessionId: id };
        }

        // Find-or-create.
        let resolved: { session: { id: string }; action: "started" | "resumed" };
        try {
          resolved = await resolveSession();
        } catch (err) {
          logCliError("auto start/resume", err);
          return { action: "error", privacy: "public" };
        }
        try {
          write(
            composeState("public", {
              librarianSessionId: resolved.session.id,
              lastActivityAt: nowIso(),
            }),
          );
        } catch (err) {
          if (isStateError(err)) return { action: "suppressed-error", privacy: "private" };
          throw err;
        }
        return { action: resolved.action, privacy: "public", sessionId: resolved.session.id };
      });
    },

    handleCheckpoint(input = {}) {
      return runExclusive<CheckpointOutcome>(async () => {
        let state: HarnessLibrarianState | null;
        try {
          state = read();
        } catch (err) {
          if (isStateError(err)) return { action: "suppressed-error" };
          throw err;
        }
        if (state?.privacy === "private") return { action: "suppressed-private" };
        const sessionId = state?.librarian_session_id;
        if (!sessionId) return { action: "no-session" };
        if (!shouldCheckpoint(input, state, now(), thresholds)) {
          return { action: "skipped-gate", sessionId };
        }
        try {
          await client.checkpoint(sessionId, input.summary?.trim() || DEFAULT_CHECKPOINT_SUMMARY);
        } catch (err) {
          logCliError("checkpoint", err);
          return { action: "error", sessionId };
        }
        try {
          write(
            composeState("public", {
              librarianSessionId: sessionId,
              lastActivityAt: nowIso(),
              lastCheckpointAt: nowIso(),
              enteredPrivateAt: state?.entered_private_at,
            }),
          );
        } catch (err) {
          if (isStateError(err)) return { action: "suppressed-error", sessionId };
          throw err;
        }
        return { action: "checkpointed", sessionId };
      });
    },

    handlePause(summary) {
      return runExclusive<PauseAction>(async () => {
        let state: HarnessLibrarianState | null;
        try {
          state = read();
        } catch (err) {
          if (isStateError(err)) return "suppressed-error";
          throw err;
        }
        if (state?.privacy === "private") return "suppressed-private";
        const sessionId = state?.librarian_session_id;
        if (!sessionId) return "no-session";
        try {
          await client.pause(sessionId, summary?.trim() || DEFAULT_PAUSE_SUMMARY);
        } catch (err) {
          logCliError("pause", err);
          return "error";
        }
        // Detach locally: the paused session is resumed via the cwd list match on
        // the next prompt (§5.2), not by a lingering local id.
        try {
          write(
            composeState("public", {
              lastActivityAt: nowIso(),
              lastCheckpointAt: state?.last_checkpoint_at,
            }),
          );
        } catch (err) {
          if (isStateError(err)) return "suppressed-error";
          throw err;
        }
        return "paused";
      });
    },

    toggle() {
      return runExclusive<PromptOutcome>(async () => {
        let state: HarnessLibrarianState | null;
        try {
          state = read();
        } catch (err) {
          if (isStateError(err)) return { action: "suppressed-error", privacy: "private" };
          throw err;
        }
        if (state?.privacy === "private") {
          try {
            write(composeState("public", { lastCheckpointAt: state.last_checkpoint_at }));
          } catch (err) {
            if (isStateError(err)) return { action: "suppressed-error", privacy: "private" };
            throw err;
          }
          return { action: "toggled-public", privacy: "public" };
        }
        const attachedId = state?.librarian_session_id;
        try {
          write(composeState("private", { enteredPrivateAt: nowIso() }));
        } catch (err) {
          if (isStateError(err)) {
            await endAttached(attachedId);
            return { action: "suppressed-error", privacy: "private" };
          }
          throw err;
        }
        await endAttached(attachedId);
        return { action: "entered-private", privacy: "private" };
      });
    },

    startExplicit(args = {}) {
      return runExclusive<ParsedSession>(async () => {
        const visibility: Visibility | undefined = args.private ? "agent_private" : undefined;
        const session = await client.start({
          harness: location.harness,
          sourceRef: deps.sourceRef,
          ...(location.cwd !== undefined ? { cwd: location.cwd } : {}),
          ...(location.projectKey !== undefined ? { projectKey: location.projectKey } : {}),
          summary: args.summary?.trim() || DEFAULT_START_SUMMARY,
          captureMode: deps.captureMode,
          ...(args.title ? { title: args.title } : {}),
          ...(visibility ? { visibility } : {}),
        });
        // An explicit start overrides off-record mode: the user asked to record.
        write(composeState("public", { librarianSessionId: session.id, lastActivityAt: nowIso() }));
        return session;
      });
    },

    list(includeEnded) {
      // Cross-harness on purpose: /lib-session-list must surface sessions from
      // ANY harness so work started in Claude/Codex/etc. can be resumed in Pi.
      // `harness` is a server-side FILTER (cwd/project_key only rank), so passing
      // harness: "pi" here would hide every non-Pi session — the opposite of the
      // handover contract. (Auto-resume in resolveSession DOES scope to this
      // harness, to avoid silently auto-attaching Pi to another harness's session.)
      return client.list({
        ...(includeEnded ? { includeEnded: true } : { statuses: ["active", "paused"] }),
        ...(location.cwd !== undefined ? { cwd: location.cwd } : {}),
        ...(location.projectKey !== undefined ? { projectKey: location.projectKey } : {}),
      });
    },

    resume(sessionId) {
      return runExclusive<string>(async () => {
        const handover = await client.continue(sessionId, {
          targetHarness: location.harness,
          ...(location.cwd !== undefined ? { targetCwd: location.cwd } : {}),
          targetSourceRef: deps.sourceRef,
        });
        write(composeState("public", { librarianSessionId: sessionId, lastActivityAt: nowIso() }));
        return handover;
      });
    },

    checkpointExplicit(summary) {
      return runExclusive<CheckpointOutcome>(async () => {
        let state: HarnessLibrarianState | null;
        try {
          state = read();
        } catch (err) {
          if (isStateError(err)) return { action: "suppressed-error" };
          throw err;
        }
        const sessionId = state?.librarian_session_id;
        if (!state || !sessionId) return { action: "no-session" };
        await client.checkpoint(sessionId, summary.trim() || DEFAULT_CHECKPOINT_SUMMARY);
        write(
          composeState(state.privacy, {
            librarianSessionId: sessionId,
            lastActivityAt: nowIso(),
            lastCheckpointAt: nowIso(),
            enteredPrivateAt: state.entered_private_at,
          }),
        );
        return { action: "checkpointed", sessionId };
      });
    },

    pauseExplicit(summary) {
      return this.handlePause(summary);
    },

    endExplicit(summary) {
      return runExclusive<void>(async () => {
        let state: HarnessLibrarianState | null;
        try {
          state = read();
        } catch (err) {
          if (isStateError(err)) return;
          throw err;
        }
        const sessionId = state?.librarian_session_id;
        if (!state || !sessionId) return;
        await client.end(sessionId, summary?.trim() || undefined);
        // Detach locally; preserve off-record flag.
        write(composeState(state.privacy, { lastActivityAt: nowIso() }));
      });
    },

    search(query, limit) {
      return client.search(query, limit);
    },

    status() {
      let state: HarnessLibrarianState | null = null;
      try {
        state = read();
      } catch {
        // status is best-effort; a state error is reported as off-record (safe).
        return { privacy: "private" };
      }
      const out: { sessionId?: string; privacy: Privacy } = {
        privacy: state?.privacy === "private" ? "private" : "public",
      };
      if (state?.librarian_session_id) out.sessionId = state.librarian_session_id;
      return out;
    },
  };
}

// Decide whether to checkpoint (§5.3) — ported verbatim from session.ts.
function shouldCheckpoint(
  input: CheckpointInput,
  state: HarnessLibrarianState | null,
  nowMs: number,
  cfg: CheckpointThresholds,
): boolean {
  if (input.trigger === "compaction" && cfg.onCompaction) return true;
  if (input.trigger === "task-completed" && cfg.onTaskCompleted) return true;

  const files = input.filesTouched ?? 0;
  const tools = input.toolCalls ?? 0;
  const hasSummary = typeof input.summary === "string" && input.summary.trim().length > 0;
  const newWork = files > 0 || tools > 0 || hasSummary;
  if (!newWork) return false;

  const countGate = files >= cfg.minFilesTouched || tools >= cfg.minToolCalls;

  const lastMs = state?.last_checkpoint_at ? Date.parse(state.last_checkpoint_at) : NaN;
  const hasPriorCheckpoint = !Number.isNaN(lastMs);
  if (!hasPriorCheckpoint) return countGate || hasSummary;

  const elapsedMin = (nowMs - lastMs) / 60_000;
  const timeGate = elapsedMin >= cfg.minIntervalMinutes;
  return countGate || timeGate || (hasSummary && timeGate);
}
