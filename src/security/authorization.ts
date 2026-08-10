export type WorkspaceRole = "owner" | "admin" | "analyst" | "viewer";
export type WorkspaceAction =
  | "workspace:manage"
  | "member:manage"
  | "connection:manage"
  | "data:read"
  | "sync:run"
  | "insight:feedback"
  | "report:share"
  | "budget:draft"
  | "promotion:draft"
  | "category_registry:read"
  | "category_registry:publish"
  | "instruction_policy:read"
  | "instruction_policy:draft"
  | "instruction_policy:publish"
  | "autonomy_rules:read"
  | "autonomy_rules:draft"
  | "guidance:read"
  | "guidance:draft"
  | "guidance:publish"
  | "practice_lab:read"
  | "practice_lab:draft"
  | "practice_lab:standardize"
  | "policy_bundle:read"
  | "policy_bundle:draft"
  | "policy_bundle:publish"
  | "decision_cadence:publish"
  | "experiment_record:mutate"
  | "business_outcome:record";

export type Actor = Readonly<{ userId: string }>;
export type WorkspaceMembership = Readonly<{
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}>;

const ROLE_ACTIONS: Readonly<Record<WorkspaceRole, ReadonlySet<WorkspaceAction>>> = {
  owner: new Set([
    "workspace:manage", "member:manage", "connection:manage", "data:read",
    "sync:run", "insight:feedback", "report:share",
    "budget:draft", "promotion:draft", "category_registry:read", "category_registry:publish",
    "instruction_policy:read", "instruction_policy:draft", "instruction_policy:publish", "autonomy_rules:read", "autonomy_rules:draft",
    "guidance:read", "guidance:draft", "guidance:publish", "practice_lab:read", "practice_lab:draft", "practice_lab:standardize",
    "policy_bundle:read", "policy_bundle:draft", "policy_bundle:publish", "decision_cadence:publish", "experiment_record:mutate", "business_outcome:record",
  ]),
  admin: new Set([
    "member:manage", "connection:manage", "data:read", "sync:run",
    "insight:feedback", "report:share",
    "budget:draft", "promotion:draft", "category_registry:read", "category_registry:publish",
    "instruction_policy:read", "instruction_policy:draft", "instruction_policy:publish", "autonomy_rules:read", "autonomy_rules:draft",
    "guidance:read", "guidance:draft", "guidance:publish", "practice_lab:read", "practice_lab:draft", "practice_lab:standardize",
    "policy_bundle:read", "policy_bundle:draft", "policy_bundle:publish", "decision_cadence:publish", "experiment_record:mutate", "business_outcome:record",
  ]),
  analyst: new Set(["data:read", "sync:run", "insight:feedback", "report:share", "budget:draft", "promotion:draft", "category_registry:read", "instruction_policy:read", "instruction_policy:draft", "autonomy_rules:read", "autonomy_rules:draft", "guidance:read", "guidance:draft", "practice_lab:read", "practice_lab:draft", "policy_bundle:read", "policy_bundle:draft", "experiment_record:mutate", "business_outcome:record"]),
  viewer: new Set(["data:read", "category_registry:read", "instruction_policy:read", "autonomy_rules:read", "guidance:read", "practice_lab:read", "policy_bundle:read"]),
};

export class AuthorizationError extends Error {
  readonly status = 403;
  readonly publicMessage = "Bu işlem için çalışma alanı yetkiniz yok.";

  constructor() {
    super("Workspace authorization denied");
    this.name = "AuthorizationError";
  }
}

export function authorizeWorkspace(
  actor: Actor,
  workspaceId: string,
  action: WorkspaceAction,
  memberships: readonly WorkspaceMembership[],
): WorkspaceMembership {
  const membership = memberships.find(
    (candidate) => candidate.userId === actor.userId && candidate.workspaceId === workspaceId,
  );
  if (!membership || !ROLE_ACTIONS[membership.role].has(action)) throw new AuthorizationError();
  return membership;
}

export function can(role: WorkspaceRole, action: WorkspaceAction): boolean {
  return ROLE_ACTIONS[role].has(action);
}
