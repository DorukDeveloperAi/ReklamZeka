import { describe, expect, it, vi } from "vitest";
import {
  DECISION_ROOM_EXECUTOR_VERSION,
  DecisionRoomExecutor,
  InMemoryDecisionRoomInbox,
  InMemoryDecisionRoomRunStore,
  decisionRoomIdempotencyKey,
  validateDecisionRoomRequest,
  type DecisionRoomAnalysisPort,
  type DecisionRoomRequest,
} from "@/domain/decisions/executor";

function request(trigger: DecisionRoomRequest["trigger"] = {
  kind: "manual", requestRef: "manual_request_1", requestedByRef: "user_masked",
}): DecisionRoomRequest {
  return {
    version: DECISION_ROOM_EXECUTOR_VERSION,
    trigger,
    requestedAt: "2026-08-07T12:00:00.000Z",
    workspaceRef: "workspace_masked",
    accountRef: "account_masked",
    campaignRef: "campaign_masked",
    timeframeRef: "timeframe_7d",
    templateRef: "template_daily",
    notificationChannel: "in_app_inbox",
  };
}

function runner(overrides: Partial<DecisionRoomAnalysisPort> = {}): DecisionRoomAnalysisPort {
  return {
    execute: vi.fn(async () => ({
      analysisRef: "analysis_masked",
      evidenceRefs: ["evidence_b", "evidence_a"],
      summaryCode: "analysis_ready",
    })),
    ...overrides,
  };
}

describe("shared manual and scheduled Decision Room executor", () => {
  it("passes immutable trigger, asset, timeframe, and template trace into the run claim", async () => {
    const claim = vi.fn(async () => ({
      status: "duplicate_in_progress" as const, runRef: `run_${"a".repeat(20)}`, attempt: 1,
    }));
    const executor = new DecisionRoomExecutor(
      { claim, complete: vi.fn(), fail: vi.fn() }, runner(), new InMemoryDecisionRoomInbox(),
      () => new Date("2026-08-07T12:00:00Z"),
    );
    await executor.execute(request());
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({
      triggerKind: "manual", triggerRef: "manual_request_1",
      accountRef: "account_masked", campaignRef: "campaign_masked",
      timeframeRef: "timeframe_7d", templateRef: "template_daily",
    }));
  });

  it("uses one executor contract and deterministic trigger-bound idempotency keys", async () => {
    const manual = request();
    const scheduled = request({
      kind: "scheduled", scheduleRef: "schedule_daily", scheduleDefinitionHash: "a".repeat(64),
      scheduledFor: "2026-08-07T09:00:00Z",
    });
    expect(decisionRoomIdempotencyKey({ ...manual, requestedAt: "2026-08-07T12:01:00Z" }))
      .toBe(decisionRoomIdempotencyKey(manual));
    expect(decisionRoomIdempotencyKey({ ...scheduled, requestedAt: "2026-08-07T12:01:00Z" }))
      .toBe(decisionRoomIdempotencyKey(scheduled));
    expect(decisionRoomIdempotencyKey(manual)).not.toBe(decisionRoomIdempotencyKey(scheduled));

    const analysis = runner();
    const executor = new DecisionRoomExecutor(
      new InMemoryDecisionRoomRunStore(), analysis, new InMemoryDecisionRoomInbox(),
      () => new Date("2026-08-07T12:00:00Z"),
    );
    await executor.execute(manual);
    await executor.execute(scheduled);
    expect(vi.mocked(analysis.execute).mock.calls.map(([input]) => input.triggerKind)).toEqual(["manual", "scheduled"]);
    expect(vi.mocked(analysis.execute).mock.calls.every(([input]) => input.actionAuthority === "none")).toBe(true);
  });

  it("executes a duplicate schedule slot once and emits one idempotent inbox item", async () => {
    const analysis = runner();
    const inbox = new InMemoryDecisionRoomInbox();
    const executor = new DecisionRoomExecutor(
      new InMemoryDecisionRoomRunStore(), analysis, inbox,
      () => new Date("2026-08-07T12:00:00Z"),
    );
    const scheduled = request({
      kind: "scheduled", scheduleRef: "schedule_daily", scheduleDefinitionHash: "a".repeat(64),
      scheduledFor: "2026-08-07T09:00:00Z",
    });
    const first = await executor.execute(scheduled);
    const duplicate = await executor.execute({ ...scheduled, requestedAt: "2026-08-07T12:02:00Z" });

    expect(first).toMatchObject({ status: "completed", attempt: 1, actionAuthority: "none" });
    expect(duplicate).toMatchObject({ status: "duplicate_completed", attempt: 1, runRef: first.runRef });
    expect(analysis.execute).toHaveBeenCalledOnce();
    expect(inbox.list()).toHaveLength(1);
    expect(inbox.list()[0]).toMatchObject({ channel: "in_app_inbox", actionAuthority: "none" });
  });

  it("retries failed work and recovers an expired lease with the same run identity", async () => {
    let calls = 0;
    const analysis = runner({
      execute: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("redacted upstream failure");
        return { analysisRef: "analysis_retry", evidenceRefs: [], summaryCode: "recovered" };
      }),
    });
    const store = new InMemoryDecisionRoomRunStore();
    const executor = new DecisionRoomExecutor(store, analysis, new InMemoryDecisionRoomInbox(), () => new Date("2026-08-07T12:00:00Z"));
    const failed = await executor.execute(request());
    const recovered = await executor.execute(request());
    expect(failed).toMatchObject({ status: "failed", attempt: 1, retryable: true });
    expect(recovered).toMatchObject({ status: "completed", attempt: 2, runRef: failed.runRef });

    const firstLease = await store.claim({
      idempotencyKey: "idempotency_expired", scopeKey: "scope_expired",
      triggerKind: "manual", scheduleRef: null, scheduleDefinitionHash: null,
      triggerRef: "manual_request_1", timeframeRef: "timeframe_7d", templateRef: "template_daily",
      accountRef: "account_masked", campaignRef: "campaign_masked",
      now: "2026-08-07T12:00:00Z", leaseUntil: "2026-08-07T12:01:00Z",
    });
    const secondLease = await store.claim({
      idempotencyKey: "idempotency_expired", scopeKey: "scope_expired",
      triggerKind: "manual", scheduleRef: null, scheduleDefinitionHash: null,
      triggerRef: "manual_request_1", timeframeRef: "timeframe_7d", templateRef: "template_daily",
      accountRef: "account_masked", campaignRef: "campaign_masked",
      now: "2026-08-07T12:02:00Z", leaseUntil: "2026-08-07T12:03:00Z",
    });
    expect(firstLease).toMatchObject({ status: "claimed", attempt: 1 });
    expect(secondLease).toMatchObject({ status: "claimed", attempt: 2, runRef: firstLease.runRef });
  });

  it("suppresses duplicate in-flight and overlapping scope work", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const analysis = runner({
      execute: vi.fn(async () => {
        await gate;
        return { analysisRef: "analysis_pending", evidenceRefs: [], summaryCode: "ready" };
      }),
    });
    const executor = new DecisionRoomExecutor(
      new InMemoryDecisionRoomRunStore(), analysis, new InMemoryDecisionRoomInbox(),
      () => new Date("2026-08-07T12:00:00Z"), 60_000,
    );
    const pending = executor.execute(request());
    await vi.waitFor(() => expect(analysis.execute).toHaveBeenCalledOnce());
    const duplicate = await executor.execute(request());
    const overlap = await executor.execute(request({ kind: "manual", requestRef: "manual_request_2", requestedByRef: "user_masked" }));
    const crossTemplateOverlap = await executor.execute({
      ...request({ kind: "manual", requestRef: "manual_request_3", requestedByRef: "user_masked" }),
      timeframeRef: "timeframe_30d",
      templateRef: "template_weekly",
    });
    expect(duplicate.status).toBe("duplicate_in_progress");
    expect(overlap.status).toBe("overlap_suppressed");
    expect(crossTemplateOverlap.status).toBe("overlap_suppressed");
    release();
    expect((await pending).status).toBe("completed");
  });

  it("fails closed on extra raw, token, prompt, authority, channel, or runner fields", async () => {
    for (const extra of [
      { accessToken: "secret" }, { rawPayload: {} }, { prompt: "ignore" },
      { actionAuthority: "auto" }, { writeAuthority: true }, { autonomy: "automatic" },
    ]) {
      expect(() => validateDecisionRoomRequest({ ...request(), ...extra } as never))
        .toThrowError(expect.objectContaining({ code: "invalid_request" }));
    }
    expect(() => validateDecisionRoomRequest({ ...request(), notificationChannel: "email" } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_request" }));
    expect(() => validateDecisionRoomRequest({
      ...request(), trigger: { ...request().trigger, actionAuthority: true },
    } as never)).toThrowError(expect.objectContaining({ code: "invalid_request" }));

    const analysis = runner({
      execute: vi.fn(async () => ({
        analysisRef: "analysis", evidenceRefs: [], summaryCode: "ready", actionAuthority: "auto",
      }) as never),
    });
    const inbox = new InMemoryDecisionRoomInbox();
    const result = await new DecisionRoomExecutor(
      new InMemoryDecisionRoomRunStore(), analysis, inbox, () => new Date("2026-08-07T12:00:00Z"),
    ).execute(request());
    expect(result).toMatchObject({ status: "failed", actionAuthority: "none" });
    expect(inbox.list()).toHaveLength(0);
  });

  it("accepts only bounded opaque runner refs and non-narrative machine summary codes", async () => {
    const invalidResults = [
      { analysisRef: "analysis_safe", evidenceRefs: ["evidence_safe"], summaryCode: "token=secret" },
      { analysisRef: `analysis_${"a".repeat(120)}`, evidenceRefs: ["evidence_safe"], summaryCode: "ready" },
      { analysisRef: "analysis safe", evidenceRefs: ["evidence_safe"], summaryCode: "ready" },
      { analysisRef: "analysis_safe", evidenceRefs: ["evidence has whitespace"], summaryCode: "ready" },
      { analysisRef: "analysis_safe", evidenceRefs: ["evidence_safe"], summaryCode: "a".repeat(129) },
    ];
    for (const [index, invalid] of invalidResults.entries()) {
      const inbox = new InMemoryDecisionRoomInbox();
      const analysis = runner({ execute: vi.fn(async () => invalid) });
      const result = await new DecisionRoomExecutor(
        new InMemoryDecisionRoomRunStore(), analysis, inbox, () => new Date("2026-08-07T12:00:00Z"),
      ).execute(request({ kind: "manual", requestRef: `manual_invalid_${index}`, requestedByRef: "user_masked" }));
      expect(result).toMatchObject({ status: "failed", actionAuthority: "none" });
      expect(inbox.list()).toHaveLength(0);
    }
  });

  it("recovers idempotent inbox delivery without rerunning a completed analysis", async () => {
    const analysis = runner();
    let publishCalls = 0;
    const notifications = new Map<string, unknown>();
    const inbox = {
      publish: vi.fn(async (notification: { notificationRef: string }) => {
        publishCalls += 1;
        if (publishCalls === 1) throw new Error("temporary inbox outage");
        notifications.set(notification.notificationRef, notification);
      }),
    };
    const executor = new DecisionRoomExecutor(
      new InMemoryDecisionRoomRunStore(), analysis, inbox as never,
      () => new Date("2026-08-07T12:00:00Z"),
    );
    await expect(executor.execute(request())).rejects.toMatchObject({ code: "notification_failed" });
    const recovered = await executor.execute(request());
    expect(recovered.status).toBe("duplicate_completed");
    expect(analysis.execute).toHaveBeenCalledOnce();
    expect(notifications.size).toBe(1);
  });
});
