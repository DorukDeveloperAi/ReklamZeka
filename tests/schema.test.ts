import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { dataSources, memberships, users, workspaces } from "@/db/schema";

describe("initial database contract", () => {
  it("keeps tenant-bearing entities explicit", () => {
    expect([users, workspaces, memberships, dataSources].map(getTableName)).toEqual([
      "users",
      "workspaces",
      "memberships",
      "data_sources",
    ]);
  });
});
