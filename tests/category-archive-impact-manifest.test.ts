import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessCategoryJsonbCatalog, CATEGORY_JSONB_MANIFEST } from
  "@/domain/categories/category-dependency-manifest";

describe("category dependency JSONB manifest", () => {
  it("classifies every JSONB declaration in the Drizzle schema exactly once", () => {
    const source = readFileSync("src/db/schema.ts", "utf8");
    let table = "";
    const actual: { table: string; column: string }[] = [];
    for (const line of source.split("\n")) {
      const tableMatch = line.match(/pgTable\("([^"]+)"/);
      if (tableMatch) table = tableMatch[1]!;
      const columnMatch = line.match(/jsonb\("([^"]+)"/);
      if (columnMatch) actual.push({ table, column: columnMatch[1]! });
    }
    expect(assessCategoryJsonbCatalog(actual)).toEqual({ unclassifiedColumns: 0, missingManifestColumns: 0 });
    expect(new Set(CATEGORY_JSONB_MANIFEST.map((entry) => `${entry.table}.${entry.column}`)).size)
      .toBe(CATEGORY_JSONB_MANIFEST.length);
    expect(CATEGORY_JSONB_MANIFEST).toContainEqual({ table: "category_profile_revisions",
      column: "profile_payload", policy: "category_contract" });
  });
});
