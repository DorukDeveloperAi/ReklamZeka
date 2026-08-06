import { authorizeWorkspace, type Actor, type WorkspaceMembership } from "@/security/authorization";
import type { AuditEventInput, AppendOnlyAuditLog } from "@/security/audit";

export type TenantResource = Readonly<{
  id: string;
  workspaceId: string;
  name: string;
}>;

export class WorkspaceDataService {
  constructor(
    private readonly memberships: readonly WorkspaceMembership[],
    private readonly resources: readonly TenantResource[],
    private readonly audit: AppendOnlyAuditLog,
  ) {}

  list(actor: Actor, workspaceId: string): readonly TenantResource[] {
    authorizeWorkspace(actor, workspaceId, "data:read", this.memberships);
    return this.resources.filter((resource) => resource.workspaceId === workspaceId).map((resource) => ({ ...resource }));
  }

  startSync(actor: Actor, workspaceId: string, dataSourceId: string, occurredAt: string): AuditEventInput {
    authorizeWorkspace(actor, workspaceId, "sync:run", this.memberships);
    const source = this.resources.find(
      (resource) => resource.id === dataSourceId && resource.workspaceId === workspaceId,
    );
    if (!source) throw new Error("Kaynak bulunamadı");
    const event: AuditEventInput = {
      workspaceId,
      actorId: actor.userId,
      action: "sync.started",
      resourceType: "data_source",
      resourceId: source.id,
      occurredAt,
    };
    this.audit.append(event);
    return event;
  }
}
