import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { currentPromotionTemplateAuthoringHeadSql } from
  "@/connectors/meta/promotion/promotion-template-authoring-active-sql";

describe("promotion template authoring actionable-head SQL", () => {
  it("keeps legacy or draft-only material active, retains the last publication through drafts, and rejects archive", () => {
    const rendered = new PgDialect().sqlToQuery(sql`select 1 where ${currentPromotionTemplateAuthoringHeadSql}`).sql;
    expect(rendered).toMatch(/managed_event\.status in \('published', 'archived'\)/);
    expect(rendered).toMatch(/or exists \(\s*select 1 from promotion_template_authoring_revisions effective_event/);
    expect(rendered).toMatch(/effective_event\.status = 'published'/);
    expect(rendered).toMatch(/effective_event\.published_template_hash = template\.template_hash/);
    expect(rendered).toMatch(/effective_event\.published_binding_hash = binding\.binding_hash/);
    expect(rendered).toMatch(/newer_event\.status in \('published', 'archived'\)/);
    expect(rendered).toMatch(/newer_event\.lifecycle_version > effective_event\.lifecycle_version/);
  });
});
