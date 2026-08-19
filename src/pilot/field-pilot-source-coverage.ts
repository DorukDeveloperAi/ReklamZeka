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
  /** Present only when server-owned dashboard verification telemetry is available. */
  activation?: Readonly<{ workspaceCount: number; accountCount: number }>;
  /** Present only when the immutable critical-incident history is available. */
  securityIncidents?: Readonly<{ workspaceCount: number; openCriticalIncidentCount: number }>;
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
  const activationWorkspaceCount = count(input.activation?.workspaceCount ?? -1);
  const activationAccountCount = count(input.activation?.accountCount ?? -1);
  const securityWorkspaceCount = count(input.securityIncidents?.workspaceCount ?? -1);
  const openCriticalIncidentCount = count(input.securityIncidents?.openCriticalIncidentCount ?? -1);
  const inventoryAvailable = workspaceCount >= 3 && accountCount >= 10;
  const freshnessAvailable = inventoryAvailable
    && freshWorkspaceCount === workspaceCount
    && freshAccountCount === accountCount;
  const feedbackAvailable = feedbackWorkspaceCount >= 3;
  const activationAvailable = inventoryAvailable
    && activationWorkspaceCount === workspaceCount
    && activationAccountCount === accountCount;
  const securityIncidentsAvailable = inventoryAvailable
    && securityWorkspaceCount === workspaceCount
    && openCriticalIncidentCount === 0;
  const activationMissingReason = activationAvailable ? null
    : input.activation === undefined ? "dashboard_verified_telemetry_not_persisted_in_postgres"
      : "dashboard_verified_coverage_below_active_account_inventory";
  const securityIncidentsMissingReason = securityIncidentsAvailable ? null
    : input.securityIncidents === undefined ? "open_resolved_critical_incident_telemetry_not_persisted_in_postgres"
      : openCriticalIncidentCount > 0 ? "open_critical_security_incidents_present"
        : "critical_incident_coverage_below_active_workspace_inventory";
  const families: readonly FieldPilotSourceCoverage[] = [
    {
      family: "account_inventory", available: inventoryAvailable, workspaceCount, accountCount,
      missingReason: inventoryAvailable ? null : "real_active_meta_inventory_below_3_workspaces_10_accounts",
    },
    {
      family: "activation", available: activationAvailable, workspaceCount: activationWorkspaceCount, accountCount: activationAccountCount,
      missingReason: activationMissingReason,
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
      family: "security_incidents", available: securityIncidentsAvailable, workspaceCount: securityWorkspaceCount, accountCount: 0,
      missingReason: securityIncidentsMissingReason,
    },
    {
      family: "attestation", available: false, workspaceCount: 0, accountCount: 0,
      missingReason: "human_real_account_attestation_not_supplied",
    },
  ];
  // A human attestation can only certify a source-complete pilot record. It
  // must never be used to fill in missing activation or incident evidence.
  // `attestation` itself remains unavailable here because it is supplied by a
  // separate human ceremony and is intentionally not inferred from database rows.
  const sourceBackedCriteriaComplete = inventoryAvailable
    && activationAvailable
    && freshnessAvailable
    && feedbackAvailable
    && securityIncidentsAvailable;
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
