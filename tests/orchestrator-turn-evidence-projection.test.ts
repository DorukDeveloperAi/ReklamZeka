import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { orchestratorPageGuide } from "@/application/orchestrator-conversation";
import { orchestratorConversationFromResponse } from "@/app/dashboard/operating-dashboard";
import { DrizzleOrchestratorConversationRepository, orchestratorTurnEvidenceFromLedger } from
  "@/connectors/agents/orchestrator-conversation-drizzle-repository";
import { CORE_SKILL_MANIFESTS } from "@/domain/orchestrator/skill-catalog";

const turnRef = `turn_${"a".repeat(32)}`;
const messageRef = `message_${"b".repeat(32)}`;
const conversationRef = `conversation_${"c".repeat(32)}`;
const at = "2026-08-14T12:00:00.000Z";

function boundLedgerRow(overrides: Record<string, unknown> = {}) {
  return {
    turn_ref: turnRef,
    page_guide: orchestratorPageGuide("rules"),
    profile_snapshot: { version: "skill-catalog/1.0.0", profileRef: "profile_workspace", revision: 4,
      profileHash: "1".repeat(64) },
    manifest_snapshots: CORE_SKILL_MANIFESTS.map(({ ref, version, hash }) => ({ ref, version, hash })),
    playbook_snapshots: [{ playbookRef: "playbook_alpha", revision: 2, playbookHash: "2".repeat(64),
      sourceRef: "source_guidance" }],
    skill_catalog_binding_hash: "3".repeat(64),
    ...overrides,
  };
}

describe("orchestrator historical turn evidence projection", () => {
  it("projects frozen page/skill evidence in stable order without refs, hashes, source IDs, or playbook text", () => {
    const evidence = orchestratorTurnEvidenceFromLedger(boundLedgerRow());
    expect(evidence).toMatchObject({ state: "bound", pageGuide: { pageLabel: "Kurallar & Yetkiler" },
      profileLabel: "Workspace skill profili · revizyon 4", historicalSourceState: "not_recorded",
      evidenceScope: "page_guidance_and_verified_workspace_playbooks",
      uncertainty: "agent_inference_no_meta_or_action_authority" });
    expect(evidence.skills.map((skill) => skill.name)).toEqual([...evidence.skills.map((skill) => skill.name)].sort());
    expect(JSON.stringify(evidence)).not.toMatch(/profile_workspace|playbook_alpha|source_guidance|[123]{32}|body|prompt/i);
  });

  it("fails closed for legacy, unavailable, missing, or tampered historical snapshots", () => {
    expect(orchestratorTurnEvidenceFromLedger(boundLedgerRow({ profile_snapshot: { version: "legacy_not_recorded" },
      manifest_snapshots: [], playbook_snapshots: [], skill_catalog_binding_hash: "LEGACY_NOT_BOUND" })).state).toBe("legacy_not_recorded");
    expect(orchestratorTurnEvidenceFromLedger(boundLedgerRow({ profile_snapshot: { version: "unavailable_not_bound" },
      manifest_snapshots: [], playbook_snapshots: [], skill_catalog_binding_hash: "UNAVAILABLE_NOT_BOUND" })).state).toBe("unavailable_not_bound");
    expect(orchestratorTurnEvidenceFromLedger(boundLedgerRow({ playbook_snapshots: [{ playbookRef: "playbook_alpha", revision: 2,
      playbookHash: "2".repeat(64), sourceRef: "source_guidance", body: "leak" }] })).state).toBe("missing_or_invalid");
  });

  it("drops malformed evidence before it reaches the dashboard and never accepts a body/source field", () => {
    const evidence = orchestratorTurnEvidenceFromLedger(boundLedgerRow());
    const payload = { conversation: { conversationRef, createdAt: at, pageGuide: orchestratorPageGuide("rules"),
      providerThreadRef: null, messages: [{ messageRef, turnRef, messageNumber: 1, role: "assistant", content: "Kanıt açıklaması", createdAt: at, evidence }] } };
    const parsed = orchestratorConversationFromResponse(payload);
    expect(parsed?.messages[0]?.evidence).toMatchObject({ state: "bound", skills: expect.any(Array) });
    expect(JSON.stringify(parsed)).not.toMatch(/playbook_alpha|source_guidance|profile_workspace|[123]{32}/);
    expect(orchestratorConversationFromResponse({ conversation: { ...payload.conversation, messages: [{ ...payload.conversation.messages[0],
      evidence: { ...evidence, body: "raw playbook" } }] } })).toBeNull();
    expect(orchestratorConversationFromResponse({ conversation: { ...payload.conversation, messages: [{ ...payload.conversation.messages[0],
      role: "user", evidence }] } })).toBeNull();
  });

  it("keeps the repository projection tenant-bound, ordered, and independent of mutable source tables", () => {
    const source = readFileSync("src/connectors/agents/orchestrator-conversation-drizzle-repository.ts", "utf8");
    const evidenceQuery = source.slice(source.indexOf("select turn.turn_ref"), source.indexOf("const evidenceByTurn"));
    expect(evidenceQuery).toContain("conversation.user_id = ${scope.userId}::uuid");
    expect(evidenceQuery).toContain("order by turn.turn_number asc");
    expect(evidenceQuery).not.toMatch(/guidance_sources|orchestrator_playbook_revisions|source_url|freshness/i);
    expect(DrizzleOrchestratorConversationRepository).toBeTypeOf("function");
  });
});
