import "server-only";

import { randomBytes } from "node:crypto";

import type { P06StatusExecutionWorker } from "@/application/p06-status-execution-worker";
import type { DrizzleP06ExecutionRepository } from "@/connectors/actions/p06-execution-drizzle-repository";
import { p06ExecutionV2Digest } from "@/domain/actions/p06-execution-v2";

type RunnableRepository = Pick<DrizzleP06ExecutionRepository, "listRunnable">;

/** Bounded server-private pending/reclaim runner. CAS ownership remains in the repository. */
export class P06StatusExecutionSchedulerWorker {
  constructor(
    private readonly dependencies: Readonly<{
      repository: RunnableRepository;
      worker: Pick<P06StatusExecutionWorker, "run">;
      now?: () => Date;
      nonce?: () => string;
    }>,
  ) {}

  async tick(limit = 25) {
    const executionRefs = await this.dependencies.repository.listRunnable(limit);
    const results: Array<Readonly<{ executionRef: string; outcome: "completed" | "conflict" }>> = [];
    for (const executionRef of executionRefs) {
      const now = this.dependencies.now?.() ?? new Date();
      const nonce = this.dependencies.nonce?.() ?? randomBytes(32).toString("hex");
      const leaseTokenHash = p06ExecutionV2Digest({ executionRef, nonce, kind: "lease" });
      const fenceHash = p06ExecutionV2Digest({ executionRef, nonce, kind: "fence" });
      try {
        await this.dependencies.worker.run({
          executionRef,
          leaseTokenHash,
          fenceHash,
          leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
        });
        results.push(Object.freeze({ executionRef, outcome: "completed" as const }));
      } catch {
        // Another worker may have won the CAS claim. The durable head remains
        // the source of truth and the next bounded tick can reclaim on expiry.
        results.push(Object.freeze({ executionRef, outcome: "conflict" as const }));
      }
    }
    return Object.freeze(results);
  }
}
