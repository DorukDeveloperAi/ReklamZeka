import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetCeilingPolicyPanel, budgetCeilingCommandFromForm, publishBudgetCeilingPolicy } from "@/app/dashboard/budget-ceiling-policy-panel";

const form = () => { const value = new FormData(); for (const [key, item] of Object.entries({ layer:"market", state:"published", market:"yerli",
  limitRef:"limit_market_main", revision:"1", previousPolicyHash:"", poolRef:"budget_pool_main", parentLimitRef:"",
  targetScopeRef:"ad_set_public_123", currency:"try", ceilingDecimal:"1000", effectiveFrom:"2026-08-18T08:00", effectiveTo:"2026-09-18T08:00" })) value.set(key, item); return value; };
afterEach(() => vi.unstubAllGlobals());
describe("budget ceiling publication panel", () => {
  it("builds a bounded first revision and rejects an invalid parent contract", () => {
    expect(budgetCeilingCommandFromForm(form())).toMatchObject({ revision:1, previousPolicyHash:null, parentLimitRef:null, currency:"TRY", effectiveFrom:"2026-08-18T05:00:00.000Z" });
    const invalid=form(); invalid.set("layer","campaign_ad_set"); expect(() => budgetCeilingCommandFromForm(invalid)).toThrow("kanonik");
  });
  it("uses only the same-origin intent endpoint and rejects authority-bearing responses", async () => {
    const fetchMock=vi.fn(async(_url:string,init:RequestInit)=>new Response(JSON.stringify({contractVersion:"budget-ceiling-policy-http/1.0.0",item:{limitRef:"limit_market_main",revision:1,policyHash:"a".repeat(64)},persistence:"inserted",auditAppended:true,authority:{canApprove:false,canExecute:false,canWriteMeta:false}}),{status:201,headers:{"content-type":"application/json"}})); vi.stubGlobal("fetch",fetchMock);
    await expect(publishBudgetCeilingPolicy(budgetCeilingCommandFromForm(form()))).resolves.toMatchObject({persistence:"inserted"});
    expect(fetchMock).toHaveBeenCalledWith("/api/budget-ceiling-policies",expect.objectContaining({method:"POST",credentials:"same-origin",headers:expect.objectContaining({"x-reklamzeka-intent":"budget-ceiling-policy-publish"})}));
    fetchMock.mockImplementationOnce(async()=>new Response(JSON.stringify({contractVersion:"budget-ceiling-policy-http/1.0.0",item:{limitRef:"limit_market_main",revision:1,policyHash:"a".repeat(64)},persistence:"inserted",auditAppended:true,authority:{canApprove:true,canExecute:false,canWriteMeta:false}}),{status:201}));
    await expect(publishBudgetCeilingPolicy(budgetCeilingCommandFromForm(form()))).rejects.toThrow("kanonik");
  });
  it("renders an explicit constraint-only human publication ceremony", () => {
    const html=renderToStaticMarkup(createElement(BudgetCeilingPolicyPanel)); expect(html).toContain("CONSTRAINT ONLY"); expect(html).toContain("Meta’ya yazmaz"); expect(html).toContain("budget-ceiling-title");
  });
});
