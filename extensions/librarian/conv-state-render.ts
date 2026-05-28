// Canonical `<conversation-state>` block renderer (§4.9).
//
// Byte-identical with the other four Librarian plugins' implementations
// (claude/codex/hermes/opencode). The five-peer rule from the family-wide
// AGENTS.md means a change here MUST land alongside an identical change
// in every other plugin's renderer — otherwise the rendered shape drifts
// across harnesses and the cross-harness handover contract breaks.

import type { ConvStateRow } from "./conv-state-client.js";

export function renderConvStateBlock(state: ConvStateRow): string {
  // `domain` is required on the wire (see ConvStateRow), but the
  // template-literal coercion would yield the literal string
  // `"undefined"` if a malformed row ever reached us at runtime —
  // worse than a crash because the model would treat it as fact.
  // The fallback string is what every plugin in the five-peer family
  // emits when domain is absent.
  const domain = state.domain ?? "unknown";
  const sessionId = state.session_id ?? "none";
  const offRecord = state.off_record ? "true" : "false";
  return [
    "<conversation-state>",
    `  conv_id: ${state.conv_id}`,
    `  domain: ${domain}`,
    `  session_id: ${sessionId}`,
    `  off_record: ${offRecord}`,
    "</conversation-state>",
  ].join("\n");
}
