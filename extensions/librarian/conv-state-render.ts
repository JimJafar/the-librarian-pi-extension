// Canonical `<conversation-state>` block renderer (§4.9).
//
// Byte-identical with the other four Librarian plugins' implementations
// (claude/codex/hermes/opencode). The five-peer rule from the family-wide
// AGENTS.md means a change here MUST land alongside an identical change
// in every other plugin's renderer — otherwise the rendered shape drifts
// across harnesses and the cross-harness handover contract breaks.

import type { ConvStateRow } from "./conv-state-client.js";

export function renderConvStateBlock(state: ConvStateRow): string {
  const sessionId = state.session_id ?? "none";
  const offRecord = state.off_record ? "true" : "false";
  return [
    "<conversation-state>",
    `  conv_id: ${state.conv_id}`,
    `  domain: ${state.domain}`,
    `  session_id: ${sessionId}`,
    `  off_record: ${offRecord}`,
    "</conversation-state>",
  ].join("\n");
}
