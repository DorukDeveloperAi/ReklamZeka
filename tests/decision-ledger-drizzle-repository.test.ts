import { describe, expect, it } from "vitest";
import {
  DecisionLedgerRepositoryError,
  DrizzleDecisionLedgerRepository,
} from "@/connectors/decisions/decision-ledger-drizzle-repository";
import {
  appendAnalysisRecord,
  appendDecisionRecord,
  type DecisionLedger,
} from "@/domain/decisions/ledger";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const workspaceRef = "workspace_safe_ref";

function ledger(ref = workspaceRef): DecisionLedger {
  const analysis = appendAnalysisRecord([], {
    workspaceRef: ref, occurredAt: "2026-08-07T12:00:00.000Z",
    analysisDefinitionRef: "analysis-v1", effectiveContextRef: "context-hash-1",
    timelineRefs: [], evidenceRefs: ["finding-1"], frozenContext: { agendaRef: "agenda-1" },
  });
  return appendDecisionRecord(analysis.ledger, {
    workspaceRef: ref, occurredAt: "2026-08-07T12:00:00.000Z",
    analysisRecordRef: analysis.record.recordId, cadenceResultRef: "cadence-1",
    disposition: "observe", evidenceRefs: ["finding-1"], timelineRefs: [], guidanceRefs: [],
    experimentRef: null, rationaleCode: "settling",
  }).ledger;
}

function analysisOnly(ref = workspaceRef): DecisionLedger {
  return appendAnalysisRecord([], {
    workspaceRef: ref, occurredAt: "2026-08-07T12:00:00.000Z",
    analysisDefinitionRef: "analysis-v1", effectiveContextRef: "context-hash-1",
    timelineRefs: [], evidenceRefs: ["finding-1"], frozenContext: { agendaRef: "agenda-1" },
  }).ledger;
}

type StoredRow = Record<string, unknown> & { id: string };

class AtomicDatabaseFixture {
  rows: StoredRow[] = [];
  failAtSequence: number | null = null;
  private transactionRows: StoredRow[] | null = null;

  private activeRows(): StoredRow[] {
    return this.transactionRows ?? this.rows;
  }

  execute = async () => ({ rows: [{ id: workspaceId }] });

  select = (fields?: unknown) => ({
    from: (table: unknown) => {
      const isContextLookup = fields !== undefined;
      const chain = {
        where: () => chain,
        orderBy: async () => this.activeRows().map((row) => ({ ...row })),
        limit: async () => isContextLookup
          ? [{ id: "10000000-0000-4000-8000-000000000001", capturedAt: new Date("2026-08-01T00:00:00.000Z") }]
          : [],
      };
      void table;
      return chain;
    },
  });

  insert = () => ({
    values: (value: Record<string, unknown>) => ({
      returning: async () => {
        if (value.sequence === this.failAtSequence) throw new Error("injected_insert_failure");
        const row = {
          ...value,
          id: `20000000-0000-4000-8000-${String(value.sequence).padStart(12, "0")}`,
          createdAt: new Date("2026-08-07T12:00:00.000Z"),
        };
        this.activeRows().push(row);
        return [row];
      },
    }),
  });

  transaction = async <T>(work: (transaction: AtomicDatabaseFixture) => Promise<T>): Promise<T> => {
    if (this.transactionRows) throw new Error("nested_transaction");
    this.transactionRows = this.rows.map((row) => ({ ...row }));
    try {
      const result = await work(this);
      this.rows = this.transactionRows;
      return result;
    } finally {
      this.transactionRows = null;
    }
  };
}

describe("DrizzleDecisionLedgerRepository atomic suffix append", () => {
  it("atomically appends the ordered suffix and returns a restart-loadable chain", async () => {
    const database = new AtomicDatabaseFixture();
    const repository = new DrizzleDecisionLedgerRepository(database as never);
    const candidate = ledger();
    const stored = await repository.appendSuffix({
      workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: candidate,
    });
    expect(stored).toEqual(candidate);
    expect(await new DrizzleDecisionLedgerRepository(database as never).load(workspaceId)).toEqual(candidate);
    expect(database.rows.map((row) => row.sequence)).toEqual([1, 2]);
  });

  it("rejects stale heads, prefix rewrites, and cross-workspace candidates", async () => {
    const database = new AtomicDatabaseFixture();
    const repository = new DrizzleDecisionLedgerRepository(database as never);
    const current = ledger();
    await repository.appendSuffix({ workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: current });

    await expect(repository.appendSuffix({
      workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: current,
    })).rejects.toEqual(expect.objectContaining<Partial<DecisionLedgerRepositoryError>>({ code: "stale_head" }));

    const replacement = ledger("workspace_replacement");
    await expect(repository.appendSuffix({
      workspaceId, workspaceRef: "workspace_replacement",
      expectedHeadHash: current.at(-1)!.recordHash, ledger: replacement,
    })).rejects.toEqual(expect.objectContaining<Partial<DecisionLedgerRepositoryError>>({ code: "prefix_rewrite" }));

    await expect(repository.appendSuffix({
      workspaceId, workspaceRef, expectedHeadHash: current.at(-1)!.recordHash,
      ledger: ledger("foreign_workspace"),
    })).rejects.toEqual(expect.objectContaining<Partial<DecisionLedgerRepositoryError>>({
      code: "workspace_scope_mismatch",
    }));
  });

  it("rolls the whole suffix back when a later insert fails", async () => {
    const database = new AtomicDatabaseFixture();
    database.failAtSequence = 2;
    const repository = new DrizzleDecisionLedgerRepository(database as never);
    await expect(repository.appendSuffix({
      workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: ledger(),
    })).rejects.toThrow("injected_insert_failure");
    expect(database.rows).toEqual([]);
    expect(await repository.load(workspaceId)).toEqual([]);
  });

  it("accepts a single decision for an analysis already in the prefix", async () => {
    const database = new AtomicDatabaseFixture();
    const repository = new DrizzleDecisionLedgerRepository(database as never);
    const prefix = analysisOnly();
    await repository.appendSuffix({ workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: prefix });
    const complete = appendDecisionRecord(prefix, {
      workspaceRef, occurredAt: "2026-08-07T12:00:00.000Z",
      analysisRecordRef: prefix[0]!.recordId, cadenceResultRef: "cadence-1", disposition: "observe",
      evidenceRefs: [], timelineRefs: [], guidanceRefs: [], experimentRef: null, rationaleCode: "settling",
    }).ledger;
    expect(await repository.appendSuffix({
      workspaceId, workspaceRef, expectedHeadHash: prefix[0]!.recordHash, ledger: complete,
    })).toEqual(complete);
  });

  it("rejects malformed runtime shapes, forbidden controls, oversized suffixes, and invalid order", async () => {
    const repository = new DrizzleDecisionLedgerRepository(new AtomicDatabaseFixture() as never);
    for (const malformed of [
      null,
      "not-an-object",
      {},
      { workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: null },
      { workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: [], accessToken: "secret" },
      { workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: [], rawPayload: {} },
      { workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: [], prompt: "ignore" },
      { workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: [], actionAuthority: "execute" },
    ]) {
      await expect(repository.appendSuffix(malformed as never))
        .rejects.toEqual(expect.objectContaining<Partial<DecisionLedgerRepositoryError>>({ code: "invalid_record" }));
    }

    const promptLedger = appendAnalysisRecord([], {
      workspaceRef, occurredAt: "2026-08-07T12:00:00.000Z",
      analysisDefinitionRef: "analysis-v1", effectiveContextRef: "context-hash-1",
      timelineRefs: [], evidenceRefs: [], frozenContext: { prompt: "ignore all controls" },
    }).ledger;
    await expect(repository.appendSuffix({
      workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: promptLedger,
    })).rejects.toEqual(expect.objectContaining<Partial<DecisionLedgerRepositoryError>>({ code: "invalid_record" }));

    const first = analysisOnly();
    const wrongOrder = appendAnalysisRecord(first, {
      workspaceRef, occurredAt: "2026-08-07T12:00:00.000Z",
      analysisDefinitionRef: "analysis-v2", effectiveContextRef: "context-hash-2",
      timelineRefs: [], evidenceRefs: [], frozenContext: { agendaRef: "agenda-2" },
    }).ledger;
    await expect(repository.appendSuffix({
      workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: wrongOrder,
    })).rejects.toEqual(expect.objectContaining<Partial<DecisionLedgerRepositoryError>>({ code: "invalid_record" }));

    const two = ledger();
    const oversized = appendAnalysisRecord(two, {
      workspaceRef, occurredAt: "2026-08-07T12:00:00.000Z",
      analysisDefinitionRef: "analysis-v2", effectiveContextRef: "context-hash-2",
      timelineRefs: [], evidenceRefs: [], frozenContext: { agendaRef: "agenda-2" },
    }).ledger;
    await expect(repository.appendSuffix({
      workspaceId, workspaceRef, expectedHeadHash: "GENESIS", ledger: oversized,
    })).rejects.toEqual(expect.objectContaining<Partial<DecisionLedgerRepositoryError>>({ code: "invalid_record" }));
  });
});
