import { describe, expect, it } from "vitest";

import { createLocalActionExecutionAdmissionService } from "@/server/local-action-execution-admission-runtime";

describe("local action execution admission runtime", () => {
  it("constructs only the private, disabled-admission composition and exposes no transport surface", () => {
    const service = createLocalActionExecutionAdmissionService({ database: { execute: async () => ({ rows: [] }), transaction: async <T>(work: (tx: never) => Promise<T>) => work(undefined as never) } as never,
      config: { origin: "http://localhost:3000", workspaceId: "00000000-0000-4000-8000-000000000001", workspaceRef: "workspace_alpha",
        userId: "00000000-0000-4000-8000-000000000002", readerRef: "actor_owner", signingKey: Buffer.alloc(32) } });
    expect(typeof service.admit).toBe("function");
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(service)).sort()).toEqual(["admit", "constructor"]);
  });
});
