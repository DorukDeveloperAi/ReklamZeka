import type { ReadOnlyAdConnector } from "@/connectors/contract";
import { withConnectorRetry } from "@/connectors/retry";
import type { InMemoryMetricStore } from "./idempotent-store";

export type IngestResult = Readonly<{
  pages: number;
  inserted: number;
  updated: number;
  unchanged: number;
  completed: boolean;
  resumeCursor?: string;
}>;

export async function runIngest(
  connector: ReadOnlyAdConnector,
  store: InMemoryMetricStore,
  workspaceId: string,
  options: Readonly<{ cursor?: string; maxPages?: number }> = {},
): Promise<IngestResult> {
  if (connector.access !== "read_only") throw new Error("MVP connector erişimi salt-okunur olmalıdır");
  if (!workspaceId) throw new Error("workspaceId zorunludur");

  let cursor = options.cursor;
  let pages = 0;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  while (options.maxPages === undefined || pages < options.maxPages) {
    const page = await withConnectorRetry(() => connector.fetchPage(cursor));
    pages += 1;
    for (const record of page.records) {
      const outcome = store.upsert(connector.toCanonical(record, workspaceId), page.observedAt);
      if (outcome === "inserted") inserted += 1;
      else if (outcome === "updated") updated += 1;
      else unchanged += 1;
    }
    cursor = page.nextCursor;
    if (cursor === undefined) {
      return { pages, inserted, updated, unchanged, completed: true };
    }
  }

  return { pages, inserted, updated, unchanged, completed: false, resumeCursor: cursor };
}
