import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { orchestratorInterviewKitSnapshotHash, orchestratorPageGuide } from "@/application/orchestrator-conversation";
import { orchestratorConversationFromResponse } from "@/app/dashboard/operating-dashboard";
import { DrizzleOrchestratorConversationRepository, orchestratorTurnEvidenceFromLedger } from
  "@/connectors/agents/orchestrator-conversation-drizzle-repository";
import { CORE_SKILL_MANIFESTS } from "@/domain/orchestrator/skill-catalog";
import { OrchestratorSkillRouter } from "@/application/orchestrator-skill-run";
import { createWorkspaceSkillCatalogBinding } from "@/domain/orchestrator/skill-catalog";
import { unavailableOrchestratorReadOnlyEvidenceContext } from "@/application/orchestrator-readonly-evidence-context";
import { OrchestratorTurnReceiptSummary } from "@/app/dashboard/orchestrator-turn-evidence";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

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
      sourceRef: "source_guidance", citation: { sourceTitle: "Meta yardım", sourceType: "official_meta_guidance",
        sourceUrl: "https://www.facebook.com/business/help/learning", freshness: "fresh" } }],
    skill_catalog_binding_hash: "3".repeat(64),
    ...overrides,
  };
}

describe("orchestrator historical turn evidence projection", () => {
  it("projects frozen page/skill evidence in stable order without refs, hashes, source IDs, or playbook text", () => {
    const evidence = orchestratorTurnEvidenceFromLedger(boundLedgerRow());
    expect(evidence).toMatchObject({ state: "bound", pageGuide: { pageLabel: "Kurallar & Yetkiler" },
      profileLabel: "Workspace skill profili · revizyon 4", historicalSourceState: "available",
      evidenceScope: "page_guidance_and_verified_workspace_playbooks",
      uncertainty: "agent_inference_no_meta_or_action_authority" });
    expect(evidence.skills.map((skill) => skill.name)).toEqual([...evidence.skills.map((skill) => skill.name)].sort());
    expect(evidence.playbooks).toEqual([{ label: "Doğrulanmış çalışma notu · revizyon 2", source: {
      title: "Meta yardım", type: "official_meta_guidance", url: "https://www.facebook.com/business/help/learning", freshness: "fresh" } }]);
    expect(JSON.stringify(evidence)).not.toMatch(/profile_workspace|playbook_alpha|source_guidance|[123]{32}|body|prompt/i);
  });

  it("fails closed for legacy, unavailable, missing, or tampered historical snapshots", () => {
    expect(orchestratorTurnEvidenceFromLedger(boundLedgerRow({ profile_snapshot: { version: "legacy_not_recorded" },
      manifest_snapshots: [], playbook_snapshots: [], skill_catalog_binding_hash: "LEGACY_NOT_BOUND" })).state).toBe("legacy_not_recorded");
    expect(orchestratorTurnEvidenceFromLedger(boundLedgerRow({ profile_snapshot: { version: "unavailable_not_bound" },
      manifest_snapshots: [], playbook_snapshots: [], skill_catalog_binding_hash: "UNAVAILABLE_NOT_BOUND" })).state).toBe("unavailable_not_bound");
    expect(orchestratorTurnEvidenceFromLedger(boundLedgerRow({ playbook_snapshots: [{ playbookRef: "playbook_alpha", revision: 2,
      playbookHash: "2".repeat(64), sourceRef: "source_guidance" }] })).historicalSourceState).toBe("detail_not_recorded");
    expect(orchestratorTurnEvidenceFromLedger(boundLedgerRow({ playbook_snapshots: [{ playbookRef: "playbook_alpha", revision: 2,
      playbookHash: "2".repeat(64), sourceRef: "source_guidance", citation: { sourceTitle: "Meta yardım",
        sourceType: "official_meta_guidance", sourceUrl: "https://example.test/bad", freshness: "fresh" } }] })).state).toBe("missing_or_invalid");
  });

  it("does not reinterpret a completed turn when its current mutable source later changes", () => {
    const frozenRow = boundLedgerRow();
    const atTurn = orchestratorTurnEvidenceFromLedger(frozenRow);
    const mutableSourceAfterTurn = { title: "Sonradan değişen başlık", url: "https://example.test/current", freshness: "stale" };
    expect(mutableSourceAfterTurn).not.toEqual(atTurn.playbooks[0]?.source);
    expect(orchestratorTurnEvidenceFromLedger(frozenRow)).toEqual(atTurn);
  });

  it("projects only the selected, frozen SkillRun receipt rather than the entire current catalog", () => {
    const catalog = createWorkspaceSkillCatalogBinding({ profile: { profileRef: "profile_workspace", revision: 4,
      profileHash: "1".repeat(64) }, manifests: CORE_SKILL_MANIFESTS.map(({ ref, version, hash }) => ({ ref, version, hash })), playbooks: [] });
    const receipt = new OrchestratorSkillRouter().route({ pageId: "analysis", message: "Kohortları karşılaştır",
      binding: catalog, evidence: unavailableOrchestratorReadOnlyEvidenceContext(), evidenceContextHash: "UNAVAILABLE_NOT_BOUND" });
    const evidence = orchestratorTurnEvidenceFromLedger(boundLedgerRow({ evidence_context_snapshot: { version: "unavailable_not_bound" },
      evidence_context_hash: "UNAVAILABLE_NOT_BOUND", skill_run_snapshot: receipt, skill_run_hash: receipt.receiptHash }));
    expect(evidence.skillRun).toMatchObject({ state: "bound", receipt: { intent: "compare", evidenceAvailability: "unavailable",
      selectedSkills: [{ name: "EvidenceIntegrityAuditor" }, { name: "CohortComparator" }],
      authority: { canPersist: false, canCreateRule: false, canDraftPolicy: false, canExecute: false, canWriteMeta: false } } });
    expect(evidence.skillRun.receipt?.selectedSkills).toHaveLength(2);
    expect(JSON.stringify(evidence.skillRun)).not.toMatch(/profile_workspace|playbook_alpha|source_guidance|raw|prompt/i);
  });

  it("keeps selected skills, source freshness and uncertainty visible without private receipt identifiers", () => {
    const evidence = { skillRun: { state: "bound" as const, receipt: { receiptRef: `skillrun_${"a".repeat(32)}`,
      receiptHash: "b".repeat(64), intent: "explain" as const, selectedSkills: [{ name: "EvidenceIntegrityAuditor", version: "1.0.0", outputContract: "facts" }],
      evidenceAvailability: "partial" as const, outputContract: "evidence-integrity-facts/1.0.0" as const,
      authority: { canPersist: false as const, canCreateRule: false as const, canDraftPolicy: false as const, canAlterScope: false as const,
        canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const } } },
      playbooks: [{ label: "Doğrulanmış çalışma notu", source: { freshness: "fresh" as const } }],
      interviewKits: { state: "bound" as const, kits: [] } };
    const html = renderToStaticMarkup(createElement(OrchestratorTurnReceiptSummary, { evidence }));
    expect(html).toContain("EvidenceIntegrityAuditor");
    expect(html).toContain("kaynak güncel");
    expect(html).toContain("belirsizlik: Agent çıkarımı, yetki yok");
    expect(html).not.toMatch(/skillrun_|[a-f0-9]{64}|source_guidance|playbook_alpha/);
  });

  it("projects only an immutable source-bound user interview kit and rejects tampering", () => {
    const snapshots = [{ kitRef: `interview_kit_${"d".repeat(32)}`, revision: 3, kitHash: "4".repeat(64), name: "Kampanya durum kontrolü",
      source: { title: "Meta yardım", url: "https://www.facebook.com/business/help/learning", version: 7,
        recordHash: "5".repeat(64), reviewBy: "2026-09-01T00:00:00.000Z" } }];
    const evidence = orchestratorTurnEvidenceFromLedger(boundLedgerRow({ interview_kit_snapshots: snapshots,
      interview_kit_binding_hash: orchestratorInterviewKitSnapshotHash(snapshots) }));
    expect(evidence.interviewKits).toEqual({ state: "bound", kits: [{ name: "Kampanya durum kontrolü", revision: 3,
      source: { title: "Meta yardım", url: "https://www.facebook.com/business/help/learning", version: 7,
        reviewBy: "2026-09-01T00:00:00.000Z" } }] });
    expect(JSON.stringify(evidence.interviewKits)).not.toContain("interview_kit_");
    expect(orchestratorTurnEvidenceFromLedger(boundLedgerRow({ interview_kit_snapshots: [{ ...snapshots[0]!, name: "Değiştirildi" }],
      interview_kit_binding_hash: orchestratorInterviewKitSnapshotHash(snapshots) })).interviewKits.state).toBe("missing_or_invalid");
  });

  it("drops malformed evidence before it reaches the dashboard and never accepts a body/source field", () => {
    const evidence = orchestratorTurnEvidenceFromLedger(boundLedgerRow());
    const payload = { conversation: { conversationRef, createdAt: at, pageGuide: orchestratorPageGuide("rules"),
      providerThreadRef: null, messages: [{ messageRef, turnRef, messageNumber: 1, role: "assistant", content: "Kanıt açıklaması", createdAt: at, evidence }] } };
    const parsed = orchestratorConversationFromResponse(payload);
    expect(parsed?.messages[0]?.evidence).toMatchObject({ state: "bound", skills: expect.any(Array) });
    expect(JSON.stringify(parsed)).not.toMatch(/playbook_alpha|source_guidance|profile_workspace|[123]{32}|raw playbook|Dönüşüm notu|İki varyant/);
    expect(orchestratorConversationFromResponse({ conversation: { ...payload.conversation, messages: [{ ...payload.conversation.messages[0],
      evidence: { ...evidence, body: "raw playbook" } }] } })).toBeNull();
    expect(orchestratorConversationFromResponse({ conversation: { ...payload.conversation, messages: [{ ...payload.conversation.messages[0],
      evidence: { ...evidence, playbooks: [{ ...evidence.playbooks[0], source: { ...evidence.playbooks[0]!.source!, url: "https://example.test/not-allowed" } }] } }] } })).toBeNull();
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
