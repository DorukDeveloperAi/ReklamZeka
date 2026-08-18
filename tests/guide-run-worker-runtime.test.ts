import { describe, expect, it } from "vitest";

import { createGuideRevision } from "@/domain/guides/guide-revision";
import { createGuideRunV12 } from "@/domain/guides/guide-run";
import { DrizzleGuideRunActiveSchedulePort, GuideRunSchedulerWorker } from "@/server/guide-run-worker-runtime";

const token = "123e4567-e89b-42d3-a456-426614174000";
const expires = "2026-08-17T06:10:00.000Z";
const at = "2026-08-17T06:01:00.000Z";
const guide = createGuideRevision({
  workspaceRef: "workspace_main", guideRef: "guide_main", revision: 1, previousRevisionHash: null,
  sliceRef: "slice_main", market: "yerli", freeText: "günlük", strict: { budgetRefs: [], rollbackConditions: [], budgetInterpretation: null },
  schedule: { frequency: "daily", timezone: "UTC", localTime: "06:00" }, mode: "recommend", actionAllowlist: [],
});

describe("GuideRunSchedulerWorker", () => {
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
});

function idFor(value:number){return `00000000-0000-4000-8000-${String(value).padStart(12,"0")}`;}
