import { describe, expect, it } from "vitest";
import { DELETE as revokeShare, POST as createShare } from "@/app/api/reports/demo-share/route";
import { GET as downloadCsv } from "@/app/api/reports/shared/[token]/csv/route";

describe("signed report HTTP contract", () => {
  it("retires fixture report creation, retrieval and revocation", async () => {
    const createdResponse = await createShare(new Request("http://localhost:3000/api/reports/demo-share", { method: "POST" }));
    expect(createdResponse.status).toBe(410);
    expect(createdResponse.headers.get("cache-control")).toBe("no-store");
    expect(await createdResponse.json()).toMatchObject({ code: "legacy_demo_retired" });
    const revokedResponse = await revokeShare(new Request("http://localhost:3000/api/reports/demo-share", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "unused" }),
    }));
    expect(revokedResponse.status).toBe(410);
    const csvResponse = await downloadCsv(new Request("http://localhost:3000/api/reports/shared/unused/csv"), { params: Promise.resolve({ token: "unused" }) });
    expect(csvResponse.status).toBe(410);
    expect(await csvResponse.json()).toMatchObject({ code: "legacy_demo_retired" });
  });
});
