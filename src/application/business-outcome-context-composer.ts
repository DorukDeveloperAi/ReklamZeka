import {
  buildEffectiveCampaignContext,
  type EffectiveCampaignContext,
  type EffectiveCampaignContextInput,
} from "@/analyses/effective-campaign-context";
import type { BusinessOutcomeEvidenceSnapshot } from "@/analyses/business-outcome-evidence";

export const BUSINESS_OUTCOME_CONTEXT_COMPOSER_VERSION = "business-outcome-context-composer/1.0.0" as const;
export type BusinessOutcomeEvidenceMaterializer = Readonly<{
  materialize(input: Readonly<{ workspaceId: string; entityRef: string; windowStart: string; windowEnd: string }>): Promise<BusinessOutcomeEvidenceSnapshot>;
}>;
export type EffectiveCampaignContextStore = Readonly<{
  save(context: EffectiveCampaignContext): Promise<Readonly<{ outcome: "inserted" | "unchanged"; record: unknown }>>;
}>;
export class BusinessOutcomeContextComposerError extends Error {
  constructor(readonly code: "invalid_input" | "stale_base_context" | "scope_mismatch") { super(`Business outcome context composition rejected: ${code}`); this.name = "BusinessOutcomeContextComposerError"; }
}
function instant(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new BusinessOutcomeContextComposerError("invalid_input"); return value; }

/** Private L4→L5 bridge. Only its materializer supplies evidence; it never provides action or Meta-write authority. */
export class BusinessOutcomeContextComposer {
  constructor(private readonly materializer: BusinessOutcomeEvidenceMaterializer, private readonly store: EffectiveCampaignContextStore) {}
  async composeAndSave(input: Readonly<{ baseContext: EffectiveCampaignContextInput; windowStart: string; windowEnd: string }>) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 3 || !Object.prototype.hasOwnProperty.call(input, "baseContext") || !Object.prototype.hasOwnProperty.call(input, "windowStart") || !Object.prototype.hasOwnProperty.call(input, "windowEnd")) throw new BusinessOutcomeContextComposerError("invalid_input");
    if (input.baseContext.history.outcomeEvidence !== undefined) throw new BusinessOutcomeContextComposerError("invalid_input");
    // Validate the unbound base before issuing a persistence query.
    buildEffectiveCampaignContext(input.baseContext);
    const evidence = await this.materializer.materialize({ workspaceId: input.baseContext.workspaceId, entityRef: input.baseContext.identity.entityRef,
      windowStart: instant(input.windowStart), windowEnd: instant(input.windowEnd) });
    if (evidence.entityRef !== input.baseContext.identity.entityRef) throw new BusinessOutcomeContextComposerError("scope_mismatch");
    if (Date.parse(evidence.materializedAt) > Date.parse(input.baseContext.capturedAt)) throw new BusinessOutcomeContextComposerError("stale_base_context");
    const context = buildEffectiveCampaignContext({ ...input.baseContext, history: { ...input.baseContext.history, outcomeEvidence: [evidence] } });
    const persisted = await this.store.save(context);
    return Object.freeze({ contractVersion: BUSINESS_OUTCOME_CONTEXT_COMPOSER_VERSION, context, persisted,
      capabilities: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
  }
}
