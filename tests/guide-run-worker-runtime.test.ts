import { describe, expect, it, vi } from "vitest";

import { createGuideRevision } from "@/domain/guides/guide-revision";
import { createGuideRunV12 } from "@/domain/guides/guide-run";
import { createGuideRunSchedulerRuntime, createLocalCodexGuideRunManualRuntime, createLocalCodexGuideRunSchedulerRuntime, DrizzleGuideRunActiveGuidePort, DrizzleGuideRunActiveSchedulePort, GuideRunManualWorker, GuideRunSchedulerWorker } from "@/server/guide-run-worker-runtime";

const token = "123e4567-e89b-42d3-a456-426614174000";
const expires = "2026-08-17T06:10:00.000Z";
const at = "2026-08-17T06:01:00.000Z";
const guide = createGuideRevision({
  workspaceRef: "workspace_main", guideRef: "guide_main", revision: 1, previousRevisionHash: null,
  sliceRef: "slice_main", market: "yerli", freeText: "günlük", strict: { budgetRefs: [], rollbackConditions: [], budgetInterpretation: null },
  schedule: { frequency: "daily", timezone: "UTC", localTime: "06:00" }, mode: "recommend", actionAllowlist: [],
});

describe("GuideRunSchedulerWorker", () => {
  it("keeps the production scheduler default-off until read and scheduler rollout stages are both enabled", () => {
    const dependencies = {
      database: {} as never,
      dailyAnalysis: {} as never,
      holisticAnalysis: {} as never,
      dataHealth: {} as never,
    };
    expect(createGuideRunSchedulerRuntime({ ...dependencies, environment: {} }))
      .toEqual({ enabled: false, scheduler: null });
    expect(createGuideRunSchedulerRuntime({ ...dependencies,
      environment: { GUIDE_SCHEDULER_ENABLED: "true" } }).enabled).toBe(false);
    expect(createGuideRunSchedulerRuntime({ ...dependencies,
      environment: { META_READ_ENABLED: "true", GUIDE_SCHEDULER_ENABLED: "true" } }).enabled).toBe(true);
    expect(createLocalCodexGuideRunSchedulerRuntime({ database: {} as never, dataHealth: {} as never,
      environment: { META_READ_ENABLED: "true", GUIDE_SCHEDULER_ENABLED: "true" } }))
      .toEqual({ enabled: false, scheduler: null });
    expect(createLocalCodexGuideRunSchedulerRuntime({ database: {} as never, dataHealth: {} as never,
      environment: { META_READ_ENABLED: "true", GUIDE_SCHEDULER_ENABLED: "true", REKLAMZEKA_GUIDE_RUN_CODEX_ENABLED: "TRUE" } }))
      .toEqual({ enabled: false, scheduler: null });
    expect(createLocalCodexGuideRunSchedulerRuntime({ database: {} as never, dataHealth: {} as never,
      environment: { META_READ_ENABLED: "true", GUIDE_SCHEDULER_ENABLED: "true", REKLAMZEKA_GUIDE_RUN_CODEX_ENABLED: "true",
        REKLAMZEKA_CODEX_EXECUTABLE: "/tmp/codex", REKLAMZEKA_CODEX_WORKSPACE_ROOT: "/tmp" } }).enabled).toBe(true);
    expect(createLocalCodexGuideRunManualRuntime({ database: {} as never, dataHealth: {} as never,
      environment: { META_READ_ENABLED: "true", GUIDE_SCHEDULER_ENABLED: "true" } })).toEqual({ enabled: false, worker: null });
    expect(createLocalCodexGuideRunManualRuntime({ database: {} as never, dataHealth: {} as never,
      environment: { META_READ_ENABLED: "true", GUIDE_SCHEDULER_ENABLED: "true", REKLAMZEKA_GUIDE_RUN_CODEX_ENABLED: "true",
        REKLAMZEKA_CODEX_EXECUTABLE: "/tmp/codex", REKLAMZEKA_CODEX_WORKSPACE_ROOT: "/tmp" } }).enabled).toBe(true);
  });

  it("does not enumerate schedules or materialize runs after the live P08 scheduler gate closes", async () => {
    const environment: Record<string, string> = {
      META_READ_ENABLED: "true",
      GUIDE_SCHEDULER_ENABLED: "true",
    };
    const execute = vi.fn();
    const runtime = createGuideRunSchedulerRuntime({
      database: { execute, transaction: vi.fn() } as never,
      dailyAnalysis: {} as never,
      holisticAnalysis: {} as never,
      dataHealth: {} as never,
      environment,
    });
    expect(runtime.enabled).toBe(true);
    environment.GUIDE_SCHEDULER_ENABLED = "false";
    await expect(runtime.scheduler!.tick({ now: at, leaseToken: token, leaseUntil: expires })).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("uses the concrete active-schedule reader (whose SQL selects the latest activation and receipt cursor) rather than a client schedule payload", async () => {
    let reads = 0;
    const schedules = new DrizzleGuideRunActiveSchedulePort({
      async execute() { reads += 1; return { rows: [] }; },
      async transaction(work: never) { return await work as never; },
    } as never);
    await expect(schedules.listActiveSchedules()).resolves.toEqual([]);
    expect(reads).toBe(1);
  });

  it("runs the concrete scheduler call-site as fire → receipt → claim/reclaim → resume → completed and replays P01 after a completion crash", async () => {
    const receipts: string[] = []; const calls: string[] = []; const projected: string[] = [];
    const due = createGuideRunV12({ workspaceRef: guide.workspaceRef, guideRef: guide.guideRef, guideRevisionHash: guide.revisionHash,
      trigger: { kind: "scheduled", scheduledFor: "2026-08-17T06:00:00.000Z" }, occurredAt: at });
    const claimed = { ...due, state: "claimed" as const, lease: { token, epoch: 1, expiresAt: expires } };
    // The scheduler transport observes persisted state on each retry.  These
    // fakes deliberately model a crash after the Agent completed but before
    // its P01 projection was acknowledged.
    let persisted = due as typeof due | typeof claimed | { readonly state: "completed"; readonly runRef: string; readonly lease: null };
    let crashAfterCompletion = true;
    const persistence = {
      async recordScheduleReceipt(value: { scheduledFor: string; runRef: string | null; missedCount: number }) { receipts.push(`${value.scheduledFor}:${value.runRef}:${value.missedCount}`); },
    };
    const service = {
      async fire() { calls.push("fire"); return persisted as never; },
      async claim() { calls.push("claim"); persisted = claimed; return claimed as never; },
      async reclaim() { calls.push("reclaim"); persisted = claimed; return claimed as never; },
      async renew() { calls.push("renew"); return claimed as never; },
      async execute() {
        calls.push("execute");
        persisted = { state: "completed", runRef: due.runRef, lease: null };
        if (crashAfterCompletion) { crashAfterCompletion = false; throw new Error("simulated_crash_after_completion"); }
        return { run: persisted, disposition: { state: "no_action" }, partial: false } as never;
      },
    };
    const ledger = { async projectPersisted({ runRef }: { runRef: string }) { projected.push(runRef); } };
    const schedules = {
      async listActiveSchedules() { return [{ workspaceId: "123e4567-e89b-42d3-a456-426614174000", guideRevisionId: "223e4567-e89b-42d3-a456-426614174000", guide, activatedAt: "2026-08-17T05:59:00.000Z", lastScheduledFor: null }]; },
    };
    const worker = new GuideRunSchedulerWorker({ persistence, service, ledger } as never, schedules);

    await expect(worker.tick({ now: at, leaseToken: token, leaseUntil: expires })).rejects.toThrow("simulated_crash_after_completion");
    // Same-token retry finds the completed immutable run; it must not execute
    // agents again and must reconcile the missing P01 projection.
    const output = await worker.tick({ now: at, leaseToken: token, leaseUntil: expires });

    expect(calls).toEqual(["fire", "claim", "execute", "fire"]);
    expect(receipts).toEqual([
      `2026-08-17T06:00:00.000Z:${due.runRef}:0`,
      `2026-08-17T06:00:00.000Z:${due.runRef}:0`,
    ]);
    expect(output).toEqual([{ runRef: due.runRef, state: "completed" }]);
    expect(projected).toEqual([due.runRef]);
  });

  it("routes limited-autonomy candidates only to the quota admission port", async () => {
    const limitedGuide=createGuideRevision({workspaceRef:"workspace_main",guideRef:"guide_limited",revision:1,previousRevisionHash:null,
      sliceRef:"slice_main",market:"yerli",freeText:"sınırlı",strict:{budgetRefs:[],rollbackConditions:[],budgetInterpretation:null},
      schedule:{frequency:"daily",timezone:"UTC",localTime:"06:00"},mode:"limited_autonomy",actionAllowlist:["status_pause"]});
    const due=createGuideRunV12({workspaceRef:limitedGuide.workspaceRef,guideRef:limitedGuide.guideRef,guideRevisionHash:limitedGuide.revisionHash,
      trigger:{kind:"scheduled",scheduledFor:"2026-08-17T06:00:00.000Z"},occurredAt:at});
    const human:string[]=[], autonomy:string[]=[];
    const worker=new GuideRunSchedulerWorker({
      persistence:{async recordScheduleReceipt(){}},
      service:{async fire(){return due;},async claim(){return {...due,state:"claimed",lease:{token,epoch:1,expiresAt:expires}};},
        async execute(){return {run:{...due,state:"completed",lease:null},disposition:{state:"staged",candidate:{routing:"limited_autonomy_review"}},partial:false};}},
      ledger:{async projectPersisted(){}},actionBindings:{async bind(){human.push("human");}},
      limitedAutonomyAdmissions:{async reserve({runRef}:{runRef:string}){autonomy.push(runRef);return {admissionId:idFor(1),admissionHash:"a".repeat(64),quotaOrdinal:1,replay:false};}},
    } as never,{async listActiveSchedules(){return [{workspaceId:idFor(2),guideRevisionId:idFor(3),guide:limitedGuide,activatedAt:"2026-08-17T05:59:00.000Z",lastScheduledFor:null}];}});
    await worker.tick({now:at,leaseToken:token,leaseUntil:expires});
    expect(human).toEqual([]);
    expect(autonomy).toEqual([due.runRef]);
  });

  it("runs one active manual Guide and reconciles completed replay without a second Agent call", async () => {
    const due=createGuideRunV12({workspaceRef:guide.workspaceRef,guideRef:guide.guideRef,guideRevisionHash:guide.revisionHash,
      trigger:{kind:"manual",requestRef:"request_manual_one"},occurredAt:at});
    const claimed={...due,state:"claimed" as const,lease:{token,epoch:1,expiresAt:expires}}; const completed={...due,state:"completed" as const,lease:null};
    let persisted:typeof due|typeof claimed|typeof completed=due; const calls:string[]=[],projected:string[]=[],bound:string[]=[];
    const worker=new GuideRunManualWorker({service:{async fire(){calls.push("fire");return persisted as never;},async claim(){calls.push("claim");persisted=claimed;return claimed as never;},
      async execute(){calls.push("execute");persisted=completed;return {run:completed,disposition:{state:"staged",candidate:{routing:"human_approval"}}};}},
      ledger:{async projectPersisted({runRef}:{runRef:string}){projected.push(runRef);}},actionBindings:{async bind({runRef}:{runRef:string}){bound.push(runRef);}},limitedAutonomyAdmissions:null} as never,
      {async loadActive(input){calls.push(`active:${input.workspaceId}`);return {workspaceId:input.workspaceId,guideRevisionId:input.revisionId,guide};}});
    const input={workspaceId:idFor(2),guideId:idFor(3),revisionId:idFor(4),requestRef:"request_manual_one",now:at,leaseToken:token,leaseUntil:expires};
    await expect(worker.run(input)).resolves.toEqual({runRef:due.runRef,state:"completed",replay:false});
    await expect(worker.run(input)).resolves.toEqual({runRef:due.runRef,state:"completed",replay:true});
    expect(calls).toEqual([`active:${idFor(2)}`,"fire","claim","execute",`active:${idFor(2)}`,"fire"]);
    expect(projected).toEqual([due.runRef,due.runRef]); expect(bound).toEqual([due.runRef]);
  });

  it("loads manual runs only from the exact active Guide head", async () => {
    const calls:string[]=[]; const port=new DrizzleGuideRunActiveGuidePort({async execute(){calls.push("active-head");return {rows:[]};},async transaction(work:never){return await work as never;}} as never);
    await expect(port.loadActive({workspaceId:idFor(2),guideId:idFor(3),revisionId:idFor(4)})).rejects.toThrow("active guide rejected");
    expect(calls).toEqual(["active-head"]);
  });
});

function idFor(value:number){return `00000000-0000-4000-8000-${String(value).padStart(12,"0")}`;}
