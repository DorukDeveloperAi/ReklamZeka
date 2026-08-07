import {
  runDecisionRoom,
  type DecisionRoomDraftPort,
  type DecisionRoomInput,
  type DecisionRoomResult,
} from "@/application/decision-room";
import {
  DrizzleDecisionLedgerRepository,
  type DecisionLedgerRepositoryError,
} from "@/connectors/decisions/decision-ledger-drizzle-repository";
import { verifyDecisionLedger, type DecisionLedger } from "@/domain/decisions/ledger";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

export type DecisionLedgerSuffixRepository = Readonly<{
  load(workspaceId: string): Promise<DecisionLedger>;
  appendSuffix(input: Readonly<{
    workspaceId: string;
    workspaceRef: string;
    expectedHeadHash: string;
    ledger: DecisionLedger;
  }>): Promise<DecisionLedger>;
}>;

export class DecisionRoomDrizzleAdapterError extends Error {
  constructor(
    readonly code: "invalid_binding" | "workspace_scope_mismatch" | "persistence_failure",
    options?: Readonly<{ cause?: unknown }>,
  ) {
    super(`Decision Room Drizzle adapter reddedildi: ${code}`, options);
    this.name = "DecisionRoomDrizzleAdapterError";
  }
}

function required(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 256) {
    throw new DecisionRoomDrizzleAdapterError("invalid_binding");
  }
  return value.trim();
}

function exactKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new DecisionRoomDrizzleAdapterError("invalid_binding");
  }
}

function hasForbiddenControl(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value as object)) return true;
  seen.add(value as object);
  if (Array.isArray(value)) {
    const forbidden = value.some((entry) => hasForbiddenControl(entry, seen));
    seen.delete(value);
    return forbidden;
  }
  const forbidden = Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return normalized.includes("prompt") || normalized.endsWith("tool") || normalized.endsWith("tools")
      || hasForbiddenControl(child, seen);
  });
  seen.delete(value);
  return forbidden;
}

/** Binds an internal workspace UUID once; dashboard/CLI calls remain scoped to the opaque workspaceRef. */
export class DecisionRoomDrizzleDraftAdapter implements DecisionRoomDraftPort {
  readonly #repository: DecisionLedgerSuffixRepository;
  readonly #workspaceId: string;
  readonly #workspaceRef: string;

  constructor(
    repository: DecisionLedgerSuffixRepository,
    binding: Readonly<{ workspaceId: string; workspaceRef: string }>,
  ) {
    exactKeys(binding, ["workspaceId", "workspaceRef"]);
    this.#repository = repository;
    this.#workspaceId = required(binding.workspaceId);
    this.#workspaceRef = required(binding.workspaceRef);
  }

  async readLedger(input: Readonly<{ workspaceRef: string }>): Promise<DecisionLedger> {
    exactKeys(input, ["workspaceRef"]);
    if (required(input.workspaceRef) !== this.#workspaceRef) {
      throw new DecisionRoomDrizzleAdapterError("workspace_scope_mismatch");
    }
    try {
      const ledger = await this.#repository.load(this.#workspaceId);
      if (ledger.some((record) => record.workspaceRef !== this.#workspaceRef)) {
        throw new DecisionRoomDrizzleAdapterError("workspace_scope_mismatch");
      }
      return ledger;
    } catch (error) {
      if (error instanceof DecisionRoomDrizzleAdapterError) throw error;
      throw new DecisionRoomDrizzleAdapterError("persistence_failure", { cause: error });
    }
  }

  async stageDraft(input: Parameters<DecisionRoomDraftPort["stageDraft"]>[0]): Promise<void> {
    exactKeys(input, ["workspaceRef", "requestRef", "draftRef", "expectedHeadHash", "ledger"]);
    if (required(input.workspaceRef) !== this.#workspaceRef) {
      throw new DecisionRoomDrizzleAdapterError("workspace_scope_mismatch");
    }
    required(input.requestRef);
    required(input.draftRef);
    if (!/^(?:GENESIS|[a-f0-9]{64})$/.test(input.expectedHeadHash)
      || !Array.isArray(input.ledger) || !verifyDecisionLedger(input.ledger)
      || !inspectMetaPersistenceWrite(input.ledger).compliant || hasForbiddenControl(input.ledger)) {
      throw new DecisionRoomDrizzleAdapterError("invalid_binding");
    }
    try {
      const stored = await this.#repository.appendSuffix({
        workspaceId: this.#workspaceId,
        workspaceRef: this.#workspaceRef,
        expectedHeadHash: input.expectedHeadHash,
        ledger: input.ledger,
      });
      if (!verifyDecisionLedger(stored) || JSON.stringify(stored) !== JSON.stringify(input.ledger)) {
        throw new DecisionRoomDrizzleAdapterError("persistence_failure");
      }
    } catch (error) {
      if (error instanceof DecisionRoomDrizzleAdapterError) throw error;
      throw new DecisionRoomDrizzleAdapterError("persistence_failure", { cause: error });
    }
  }
}

export type BoundDecisionRoomApplication = Readonly<{
  run(input: DecisionRoomInput): Promise<DecisionRoomResult>;
}>;

export function bindDecisionRoomApplication(input: Readonly<{
  repository: DecisionLedgerSuffixRepository;
  workspaceId: string;
  workspaceRef: string;
}>): BoundDecisionRoomApplication {
  exactKeys(input, ["repository", "workspaceId", "workspaceRef"]);
  const workspaceRef = required(input.workspaceRef);
  const adapter = new DecisionRoomDrizzleDraftAdapter(input.repository, {
    workspaceId: input.workspaceId,
    workspaceRef,
  });
  return Object.freeze({
    async run(runInput: DecisionRoomInput): Promise<DecisionRoomResult> {
      if (runInput.workspaceRef !== workspaceRef) {
        throw new DecisionRoomDrizzleAdapterError("workspace_scope_mismatch");
      }
      return runDecisionRoom(runInput, adapter);
    },
  });
}

export function bindDrizzleDecisionRoomApplication(
  database: ConstructorParameters<typeof DrizzleDecisionLedgerRepository>[0],
  binding: Readonly<{ workspaceId: string; workspaceRef: string }>,
): BoundDecisionRoomApplication {
  return bindDecisionRoomApplication({
    repository: new DrizzleDecisionLedgerRepository(database),
    workspaceId: binding.workspaceId,
    workspaceRef: binding.workspaceRef,
  });
}

// Keeps the repository error available to server composition without widening the public result.
export type DecisionRoomPersistenceCause = DecisionLedgerRepositoryError;
