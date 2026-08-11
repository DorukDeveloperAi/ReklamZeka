export const FIELD_PILOT_SOURCE_FAMILIES = [
  "account_inventory",
  "activation",
  "freshness",
  "feedback",
  "security_incidents",
  "attestation",
] as const;

export type FieldPilotSourceFamily = (typeof FIELD_PILOT_SOURCE_FAMILIES)[number];

export type FieldPilotSourceCoverage = Readonly<{
  family: FieldPilotSourceFamily;
  available: boolean;
  workspaceCount: number;
  accountCount: number;
  missingReason: string | null;
}>;

export type FieldPilotSourceCoverageInput = Readonly<{
  accountInventory: Readonly<{ workspaceCount: number; accountCount: number }>;
  freshSync: Readonly<{ workspaceCount: number; accountCount: number }>;
  feedback: Readonly<{ workspaceCount: number }>;
}>;

export type FieldPilotSourceCensus = Readonly<{
  requiredWorkspaceCount: 3;
  requiredAccountCount: 10;
  workspaceCount: number;
  accountCount: number;
  sourceBackedCriteriaComplete: boolean;
  eligibleForFieldPilotAttestation: boolean;
  families: readonly FieldPilotSourceCoverage[];
}>;

function count(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Produces an aggregate-only readiness census. It intentionally does not turn
 * missing pilot telemetry/attestation into a passing field-pilot claim.
 */
export function evaluateFieldPilotSourceCoverage(input: FieldPilotSourceCoverageInput): FieldPilotSourceCensus {
  const workspaceCount = count(input.accountInventory.workspaceCount);
  const accountCount = count(input.accountInventory.accountCount);
  const freshWorkspaceCount = count(input.freshSync.workspaceCount);
  const freshAccountCount = count(input.freshSync.accountCount);
  const feedbackWorkspaceCount = count(input.feedback.workspaceCount);
  const inventoryAvailable = workspaceCount >= 3 && accountCount >= 10;
  const freshnessAvailable = inventoryAvailable
    && freshWorkspaceCount === workspaceCount
    && freshAccountCount === accountCount;
  const feedbackAvailable = feedbackWorkspaceCount >= 3;
  const families: readonly FieldPilotSourceCoverage[] = [
    {
      family: "account_inventory", available: inventoryAvailable, workspaceCount, accountCount,
      missingReason: inventoryAvailable ? null : "real_active_meta_inventory_below_3_workspaces_10_accounts",
    },
    {
      family: "activation", available: false, workspaceCount: 0, accountCount: 0,
      missingReason: "dashboard_verified_telemetry_not_persisted_in_postgres",
    },
    {
      family: "freshness", available: freshnessAvailable, workspaceCount: freshWorkspaceCount, accountCount: freshAccountCount,
      missingReason: freshnessAvailable ? null : "fresh_completed_sync_coverage_below_active_account_inventory",
    },
    {
      family: "feedback", available: feedbackAvailable, workspaceCount: feedbackWorkspaceCount, accountCount: 0,
      missingReason: feedbackAvailable ? null : "insight_feedback_coverage_below_3_workspaces",
    },
    {
      family: "security_incidents", available: false, workspaceCount: 0, accountCount: 0,
      missingReason: "open_resolved_critical_incident_telemetry_not_persisted_in_postgres",
    },
    {
      family: "attestation", available: false, workspaceCount: 0, accountCount: 0,
      missingReason: "human_real_account_attestation_not_supplied",
    },
  ];
  const sourceBackedCriteriaComplete = inventoryAvailable && freshnessAvailable && feedbackAvailable;
  return {
    requiredWorkspaceCount: 3,
    requiredAccountCount: 10,
    workspaceCount,
    accountCount,
    sourceBackedCriteriaComplete,
    eligibleForFieldPilotAttestation: sourceBackedCriteriaComplete,
    families,
  };
}
