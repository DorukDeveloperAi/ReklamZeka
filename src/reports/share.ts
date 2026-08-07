import { createHmac, timingSafeEqual } from "node:crypto";
import type { PerformanceSnapshot } from "@/domain/ads/performance";
import type { Insight } from "@/insights/schema";
import { authorizeWorkspace, type Actor, type WorkspaceMembership } from "@/security/authorization";
import type { AppendOnlyAuditLog } from "@/security/audit";

export type ShareClaims = Readonly<{
  shareId: string;
  workspaceId: string;
  snapshotId: string;
  expiresAt: string;
  access: "read_only";
}>;

export class ShareLinkError extends Error {
  constructor(readonly code: "invalid" | "expired" | "revoked" | "snapshot_mismatch", message: string) {
    super(message);
    this.name = "ShareLinkError";
  }
}

const SHARE_ERROR_CODES = new Set(["invalid", "expired", "revoked", "snapshot_mismatch"]);

export function isShareLinkError(error: unknown): error is ShareLinkError {
  return error instanceof ShareLinkError || Boolean(
    error && typeof error === "object"
    && (error as { name?: unknown }).name === "ShareLinkError"
    && typeof (error as { code?: unknown }).code === "string"
    && SHARE_ERROR_CODES.has((error as { code: string }).code),
  );
}

function signature(payload: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export class ShareLinkService {
  private readonly revoked = new Set<string>();

  constructor(private readonly signingSecret: Buffer) {
    if (signingSecret.byteLength < 32) throw new Error("Rapor imzalama sırrı en az 32 byte olmalıdır");
  }

  create(claims: Omit<ShareClaims, "access">, now: string): string {
    const lifetime = Date.parse(claims.expiresAt) - Date.parse(now);
    if (!Number.isFinite(lifetime) || lifetime < 60_000 || lifetime > 30 * 86_400_000) {
      throw new ShareLinkError("invalid", "Paylaşım süresi 1 dakika ile 30 gün arasında olmalıdır");
    }
    const payload = Buffer.from(JSON.stringify({ ...claims, access: "read_only" })).toString("base64url");
    return `${payload}.${signature(payload, this.signingSecret)}`;
  }

  createAuthorized(
    actor: Actor,
    memberships: readonly WorkspaceMembership[],
    audit: AppendOnlyAuditLog,
    claims: Omit<ShareClaims, "access">,
    now: string,
  ): string {
    authorizeWorkspace(actor, claims.workspaceId, "report:share", memberships);
    const token = this.create(claims, now);
    audit.append({
      workspaceId: claims.workspaceId,
      actorId: actor.userId,
      action: "report.shared",
      resourceType: "report_share",
      resourceId: claims.shareId,
      occurredAt: now,
      metadata: { snapshotId: claims.snapshotId, expiresAt: claims.expiresAt, access: "read_only" },
    });
    return token;
  }

  verify(token: string, now: string): ShareClaims {
    const [payload, supplied] = token.split(".");
    if (!payload || !supplied) throw new ShareLinkError("invalid", "Paylaşım belirteci geçersiz");
    const expected = signature(payload, this.signingSecret);
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new ShareLinkError("invalid", "Paylaşım imzası geçersiz");
    }
    let claims: ShareClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new ShareLinkError("invalid", "Paylaşım payload'ı geçersiz");
    }
    if (claims.access !== "read_only") throw new ShareLinkError("invalid", "Paylaşım yalnız salt-okunur olabilir");
    if (this.revoked.has(claims.shareId)) throw new ShareLinkError("revoked", "Paylaşım bağlantısı iptal edildi");
    if (Date.parse(now) >= Date.parse(claims.expiresAt)) throw new ShareLinkError("expired", "Paylaşım bağlantısının süresi doldu");
    return claims;
  }

  revoke(shareId: string): void {
    this.revoked.add(shareId);
  }

  revokeAuthorized(
    actor: Actor,
    memberships: readonly WorkspaceMembership[],
    audit: AppendOnlyAuditLog,
    token: string,
    now: string,
  ): ShareClaims {
    const claims = this.verify(token, now);
    authorizeWorkspace(actor, claims.workspaceId, "report:share", memberships);
    this.revoke(claims.shareId);
    audit.append({
      workspaceId: claims.workspaceId,
      actorId: actor.userId,
      action: "report.revoked",
      resourceType: "report_share",
      resourceId: claims.shareId,
      occurredAt: now,
      metadata: { snapshotId: claims.snapshotId, access: "read_only" },
    });
    return claims;
  }
}

export function buildSharedReport(
  claims: ShareClaims,
  snapshotId: string,
  performance: PerformanceSnapshot,
  insights: readonly Insight[],
) {
  if (claims.snapshotId !== snapshotId) throw new ShareLinkError("snapshot_mismatch", "Rapor snapshot'ı paylaşım kaydıyla eşleşmiyor");
  return {
    access: claims.access,
    workspaceId: claims.workspaceId,
    snapshotId,
    expiresAt: claims.expiresAt,
    source: {
      asOf: performance.asOf,
      freshness: performance.freshness,
      currency: performance.currency,
      timezone: performance.timezone,
      attribution: performance.attributionLabels,
    },
    metrics: performance.current,
    campaigns: performance.campaigns,
    insights,
  } as const;
}

export function reportCsv(report: ReturnType<typeof buildSharedReport>): string {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = [
    ["campaign", "platform", "spend_minor", "conversions", "roas", "as_of", "currency"],
    ...report.campaigns.map((campaign) => [
      campaign.name, campaign.platform, campaign.totals.spendMinor,
      campaign.totals.conversions, campaign.totals.roas ?? "", report.source.asOf, report.source.currency,
    ]),
  ];
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}
