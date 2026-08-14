import { readFileSync } from "node:fs"; import { describe,expect,it } from "vitest";
describe("SkillCatalogPanel public-safe browser surface",()=>it("has a GET-only safe rendering surface",()=>{const s=readFileSync("src/app/dashboard/skill-catalog-panel.tsx","utf8");expect(s).toContain('"skill-catalog-read"');expect(s).not.toMatch(/method:\s*["']POST|textarea|input|button|hash|body/i);}));
