import type { MetaTrustReadinessReport } from "@/domain/meta/trust-readiness";

export const META_TRUST_READINESS_READ_VERSION = "meta-trust-readiness-read/1.0.0" as const;

export type PublicMetaTrustReadinessReport = Readonly<{
  connectionRef: string;
  report: MetaTrustReadinessReport;
}>;

export type MetaTrustReadinessReadProjection = Readonly<{
  version: typeof META_TRUST_READINESS_READ_VERSION;
  reports: readonly PublicMetaTrustReadinessReport[];
  authority: Readonly<{
    actionAuthority: "none";
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
}>;

export type MetaTrustReadinessReadRepository = Readonly<{
  load(workspaceId: string): Promise<MetaTrustReadinessReadProjection>;
}>;

/** Application boundary for canonical, read-only Meta quality evidence. */
export class MetaTrustReadinessReadService {
  constructor(private readonly repository: MetaTrustReadinessReadRepository) {}

  read(workspaceId: string): Promise<MetaTrustReadinessReadProjection> {
    return this.repository.load(workspaceId);
  }
}
