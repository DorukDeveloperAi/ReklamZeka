import "server-only";

// Public connector path intentionally exposes only the concrete authority.
// The trusted-catalog minting closure remains private to its server module.
export { DrizzlePrimaryResultActionCatalogAdapter } from "@/domain/operations/internal/trusted-primary-result-catalog";
