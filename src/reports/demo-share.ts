import { createHash, randomUUID } from "node:crypto";
import { dashboardResponse } from "@/app/api/dashboard/route";
import { insightsResponse } from "@/app/api/insights/route";
import { AppendOnlyAuditLog } from "@/security/audit";
import type { WorkspaceMembership } from "@/security/authorization";
import { buildSharedReport, reportCsv, ShareLinkError, ShareLinkService } from "./share";

export const DEMO_REPORT_WORKSPACE_ID = "demo-workspace";
export const DEMO_REPORT_SNAPSHOT_ID = "demo:delayed:7";
const DEMO_ACTOR = { userId: "demo-analyst" } as const;
const DEMO_MEMBERSHIPS: readonly WorkspaceMembership[] = [
  { userId: DEMO_ACTOR.userId, workspaceId: DEMO_REPORT_WORKSPACE_ID, role: "analyst" },
];

export class ReportRuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportRuntimeConfigurationError";
  }
}

export function isReportRuntimeConfigurationError(error: unknown): error is ReportRuntimeConfigurationError {
  return error instanceof ReportRuntimeConfigurationError || Boolean(
    error && typeof error === "object" && (error as { name?: unknown }).name === "ReportRuntimeConfigurationError",
  );
}

export function reportSigningKeyFromBase64(value: string | undefined): Buffer {
  const encoded = value?.trim();
  if (!encoded) throw new ReportRuntimeConfigurationError("REPORT_SIGNING_KEY yapılandırılmadı");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new ReportRuntimeConfigurationError("REPORT_SIGNING_KEY geçerli base64 olmalıdır");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength < 32 || key.toString("base64") !== encoded) {
    throw new ReportRuntimeConfigurationError("REPORT_SIGNING_KEY en az 32 byte base64 anahtar olmalıdır");
  }
  return key;
}

export type CreatedDemoShare = Readonly<{
  token: string;
  shareId: string;
  expiresAt: string;
  access: "read_only";
}>;

export class DemoReportShareService {
  private readonly links: ShareLinkService;
  private readonly audit = new AppendOnlyAuditLog();

  constructor(signingKey: Buffer) {
    this.links = new ShareLinkService(signingKey);
  }

  create(now: string, lifetimeMinutes = 24 * 60): CreatedDemoShare {
    if (!Number.isSafeInteger(lifetimeMinutes) || lifetimeMinutes < 1 || lifetimeMinutes > 30 * 24 * 60) {
      throw new ShareLinkError("invalid", "Paylaşım süresi 1 dakika ile 30 gün arasında olmalıdır");
    }
    const shareId = randomUUID();
    const expiresAt = new Date(Date.parse(now) + lifetimeMinutes * 60_000).toISOString();
    const token = this.links.createAuthorized(DEMO_ACTOR, DEMO_MEMBERSHIPS, this.audit, {
      shareId,
      workspaceId: DEMO_REPORT_WORKSPACE_ID,
      snapshotId: DEMO_REPORT_SNAPSHOT_ID,
      expiresAt,
    }, now);
    return { token, shareId, expiresAt, access: "read_only" };
  }

  read(token: string, now: string) {
    const claims = this.links.verify(token, now);
    if (claims.workspaceId !== DEMO_REPORT_WORKSPACE_ID) {
      throw new ShareLinkError("invalid", "Paylaşım çalışma alanı bu raporla eşleşmiyor");
    }
    const performance = dashboardResponse(7, "delayed").snapshot;
    return buildSharedReport(claims, DEMO_REPORT_SNAPSHOT_ID, performance, insightsResponse(7, "delayed"));
  }

  csv(token: string, now: string): string {
    return reportCsv(this.read(token, now));
  }

  revoke(token: string, now: string): string {
    return this.links.revokeAuthorized(DEMO_ACTOR, DEMO_MEMBERSHIPS, this.audit, token, now).shareId;
  }

  auditEvents() {
    return this.audit.list(DEMO_REPORT_WORKSPACE_ID);
  }
}

type DemoRuntimeRegistry = {
  fingerprint: string;
  service: DemoReportShareService;
};

const runtimeGlobal = globalThis as typeof globalThis & { __reklamzekaDemoReports?: DemoRuntimeRegistry };

export function demoReportRuntime(): DemoReportShareService {
  const key = reportSigningKeyFromBase64(process.env.REPORT_SIGNING_KEY);
  const fingerprint = createHash("sha256").update(key).digest("hex");
  if (!runtimeGlobal.__reklamzekaDemoReports || runtimeGlobal.__reklamzekaDemoReports.fingerprint !== fingerprint) {
    runtimeGlobal.__reklamzekaDemoReports = { fingerprint, service: new DemoReportShareService(key) };
  }
  return runtimeGlobal.__reklamzekaDemoReports.service;
}
