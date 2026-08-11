import { describe, expect, it } from "vitest";

import { NormalizationWorkbenchService, NormalizationWorkbenchServiceError, type NormalizationWorkbenchRepository } from "@/application/normalization-workbench-service";

const hash = "a".repeat(64);
const principal = { actor: { userId: "00000000-0000-4000-8000-000000000001" }, workspaceId: "00000000-0000-4000-8000-000000000002",
  workspaceRef: "workspace_alpha", readerRef: "reader_alpha" };
const membership = { workspaceId: principal.workspaceId, userId: principal.actor.userId, role: "analyst" as const };
const answers = { normalizedGuidance: { title: "Bütçeyi koru", body: "Aktarım yapma", topic: "budget", strength: "must" as const },
  assumptions: [], questions: [] };

describe("normalization workbench service", () => {
  it("uses the server-owned actor and a new draft-only chain", async () => {
    let received: Record<string, unknown> | null = null;
    const repository = { inspect: async () => [], preview: async () => ({ disposition: "needs_input" }), create: async (input: Record<string, unknown>) => {
      received = input; return { normalizationRef: input.normalizationRef, revision: 1, revisionHash: hash, selectionHash: hash,
        capabilities: { canPublish: false, canPromotePolicy: false, canApprove: false, canExecute: false, canWriteMeta: false } };
    } };
    const service = new NormalizationWorkbenchService(repository as unknown as NormalizationWorkbenchRepository, [membership] as never);
    const result = await service.create(principal as never, { expectedSelectionHash: hash,
      selection: { sourceRef: "source_owner", cardRef: "guidance_budget", setRef: "guidance_set_budget" }, answers });
    expect(received).toMatchObject({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, actorRef: "reader_alpha",
      role: "analyst", expectedHeadHash: "GENESIS" });
    const captured = received as unknown as Record<string, unknown>;
    expect(captured.normalizationRef).toMatch(/^normalization_[a-f0-9]{24}$/);
    expect(result.authority).toMatchObject({ canDraft: true, canPublish: false, canExecute: false, canWriteMeta: false });
  });

  it("rejects viewer writes and injected selection fields", async () => {
    const repository = { inspect: async () => [], preview: async () => null, create: async () => null };
    const viewer = { ...membership, role: "viewer" as const };
    const service = new NormalizationWorkbenchService(repository as unknown as NormalizationWorkbenchRepository, [viewer] as never);
    await expect(service.create(principal as never, { expectedSelectionHash: hash,
      selection: { sourceRef: "source_owner", cardRef: "guidance_budget", setRef: "guidance_set_budget" }, answers }))
      .rejects.toMatchObject({ name: "AuthorizationError", status: 403 });
    const analyst = new NormalizationWorkbenchService(repository as unknown as NormalizationWorkbenchRepository, [membership] as never);
    await expect(analyst.create(principal as never, { expectedSelectionHash: hash,
      selection: { sourceRef: "source_owner", cardRef: "guidance_budget", setRef: "guidance_set_budget", authority: true }, answers } as never))
      .rejects.toBeInstanceOf(NormalizationWorkbenchServiceError);
  });
});
