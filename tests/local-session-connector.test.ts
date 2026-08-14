import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  connectLocalDashboardSession,
  LocalSessionConnector,
} from "@/app/dashboard/local-session-connector";

describe("local dashboard session connector", () => {
  it("renders a password-only, explicit operator flow without embedding proof material", () => {
    const html = renderToStaticMarkup(createElement(LocalSessionConnector, {
      onVerify: async () => true,
    }));
    expect(html).toContain("npm run local-session:mint");
    expect(html).toContain("Tek kullanımlık yerel oturum capability");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("saklanmaz");
    expect(html).not.toContain("rzs1.");
  });

  it("posts an exact bodyless same-origin bootstrap and verifies the resulting cookie", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    const verify = vi.fn(async () => true);
    const result = await connectLocalDashboardSession({ capability: "  proof-secret  ", request, verify });
    expect(result).toEqual({ status: "connected" });
    expect(request).toHaveBeenCalledWith("/api/local-session", {
      method: "POST",
      headers: {
        Authorization: "Bearer proof-secret",
        "X-ReklamZeka-Intent": "bootstrap-local-session",
      },
      credentials: "same-origin",
    });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("keeps rejection, missing config and failed post-cookie verification distinct", async () => {
    const verify = vi.fn(async () => true);
    await expect(connectLocalDashboardSession({ capability: "proof", verify,
      request: async () => new Response(null, { status: 403 }) })).resolves.toEqual({ status: "rejected" });
    await expect(connectLocalDashboardSession({ capability: "proof", verify,
      request: async () => new Response(null, { status: 503 }) })).resolves.toEqual({ status: "not_configured" });
    await expect(connectLocalDashboardSession({ capability: "proof", verify: async () => false,
      request: async () => new Response(null, { status: 204 }) })).resolves.toEqual({ status: "verification_failed" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects empty or oversized input before issuing a request", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    const verify = vi.fn(async () => true);
    await expect(connectLocalDashboardSession({ capability: "", request, verify })).resolves.toEqual({ status: "invalid_input" });
    await expect(connectLocalDashboardSession({ capability: "x".repeat(4097), request, verify })).resolves.toEqual({ status: "invalid_input" });
    expect(request).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
});
