import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE as revokeShare, POST as createShare } from "@/app/api/reports/demo-share/route";
import { GET as downloadCsv } from "@/app/api/reports/shared/[token]/csv/route";

const originalSigningKey = process.env.REPORT_SIGNING_KEY;

describe("signed report HTTP contract", () => {
  beforeAll(() => {
    process.env.REPORT_SIGNING_KEY = Buffer.alloc(32, 11).toString("base64");
  });

  afterAll(() => {
    if (originalSigningKey === undefined) delete process.env.REPORT_SIGNING_KEY;
    else process.env.REPORT_SIGNING_KEY = originalSigningKey;
  });

  it("creates, downloads and revokes the same bearer report", async () => {
    const createdResponse = await createShare(new Request("http://localhost:3000/api/reports/demo-share", { method: "POST" }));
    expect(createdResponse.status).toBe(200);
    expect(createdResponse.headers.get("cache-control")).toBe("no-store");
    const created = await createdResponse.json() as { token: string; reportUrl: string; csvUrl: string; access: string };
    expect(created).toMatchObject({ access: "read_only" });
    expect(created.reportUrl).toContain("/reports/shared/");
    expect(created.csvUrl).toContain("/api/reports/shared/");

    const csvResponse = await downloadCsv(new Request(created.csvUrl), { params: Promise.resolve({ token: created.token }) });
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csvResponse.headers.get("content-disposition")).toContain("attachment");
    expect(csvResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(csvResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await csvResponse.text()).toContain('"Yaz fırsatları","meta_ads"');

    const revokedResponse = await revokeShare(new Request("http://localhost:3000/api/reports/demo-share", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: created.token }),
    }));
    expect(revokedResponse.status).toBe(200);

    const rejectedCsv = await downloadCsv(new Request(created.csvUrl), { params: Promise.resolve({ token: created.token }) });
    expect(rejectedCsv.status).toBe(410);
    expect(await rejectedCsv.json()).toEqual({ code: "revoked" });

    const tamperedCsv = await downloadCsv(new Request(`${created.csvUrl}x`), { params: Promise.resolve({ token: `${created.token}x` }) });
    expect(tamperedCsv.status).toBe(404);
    expect(await tamperedCsv.json()).toEqual({ code: "invalid" });
  });
});
