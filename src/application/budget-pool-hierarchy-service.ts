import {
  createBudgetPoolHierarchy,
  type BudgetPoolHierarchy,
  type BudgetPoolNode,
} from "@/domain/budget/budget-pool-hierarchy";

export type BudgetPoolHierarchyRevision = Readonly<{
  workspaceId: string;
  revision: number;
  previousHierarchyHash: "GENESIS" | string;
  idempotencyKey: string;
  hierarchy: BudgetPoolHierarchy;
}>;

export type CreateBudgetPoolHierarchyRevisionInput = Readonly<{
  workspaceId: string;
  revision: number;
  previousHierarchyHash: "GENESIS" | string;
  idempotencyKey: string;
  nodes: readonly BudgetPoolNode[];
}>;

export interface BudgetPoolHierarchyRevisionPort {
  append(input: Readonly<{ revision: BudgetPoolHierarchyRevision; actorId: string }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    auditAppended: boolean;
  }>>;
}

export class BudgetPoolHierarchyRevisionError extends Error {
  constructor(readonly code: "invalid_input" | "corrupt_revision") {
    super(`Bütçe havuzu kaydı reddedildi: ${code}`);
    this.name = "BudgetPoolHierarchyRevisionError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;

export function createBudgetPoolHierarchyRevision(input: CreateBudgetPoolHierarchyRevisionInput): BudgetPoolHierarchyRevision {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 5
    || !UUID.test(input.workspaceId) || !Number.isInteger(input.revision) || input.revision < 1
    || !REF.test(input.idempotencyKey)
    || (input.revision === 1 ? input.previousHierarchyHash !== "GENESIS" : !HASH.test(input.previousHierarchyHash))) {
    throw new BudgetPoolHierarchyRevisionError("invalid_input");
  }
  return Object.freeze({ workspaceId: input.workspaceId, revision: input.revision,
    previousHierarchyHash: input.previousHierarchyHash, idempotencyKey: input.idempotencyKey,
    hierarchy: createBudgetPoolHierarchy({ nodes: input.nodes }) });
}

export function verifyBudgetPoolHierarchyRevision(value: unknown): value is BudgetPoolHierarchyRevision {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const revision = value as BudgetPoolHierarchyRevision;
    const rebuilt = createBudgetPoolHierarchyRevision({ workspaceId: revision.workspaceId, revision: revision.revision,
      previousHierarchyHash: revision.previousHierarchyHash, idempotencyKey: revision.idempotencyKey,
      nodes: revision.hierarchy.nodes });
    return JSON.stringify(revision) === JSON.stringify(rebuilt);
  } catch { return false; }
}

export class BudgetPoolHierarchyService {
  constructor(private readonly revisions: BudgetPoolHierarchyRevisionPort) {}

  async save(actorId: string, input: CreateBudgetPoolHierarchyRevisionInput) {
    if (!UUID.test(actorId)) throw new BudgetPoolHierarchyRevisionError("invalid_input");
    const revision = createBudgetPoolHierarchyRevision(input);
    const persisted = await this.revisions.append({ revision, actorId });
    return Object.freeze({ contractVersion: "budget-pool-hierarchy-result/1.0.0" as const, revision,
      persistence: persisted.outcome, auditAppended: persisted.auditAppended,
      authority: revision.hierarchy.authority });
  }
}
