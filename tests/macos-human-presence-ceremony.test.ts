import { describe, expect, it, vi } from "vitest";

import { MacOsHumanPresenceCeremony } from "@/security/macos-human-presence-ceremony";

const input = Object.freeze({
  request: new Request("http://localhost:3000/api/approval-queue"),
  workspaceId: "11111111-1111-4111-a111-111111111111",
  actorRef: "actor_owner",
  unitRef: "action_unit_aaaaaaaaaaaaaaaaaaaa",
  action: "approve" as const,
});

describe("macOS human-presence ceremony", () => {
  it("uses osascript without a shell and binds the public unit plus exact decision", async () => {
    const run = vi.fn(async (_file: string, _args: readonly string[], _options: Readonly<{
      timeout: number; maxBuffer: number; encoding: "utf8";
    }>) => ({ stdout: "confirmed\n" }));
    await expect(new MacOsHumanPresenceCeremony(run, "darwin").confirm(input)).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
    const [file, args, options] = run.mock.calls[0]!;
    expect(file).toBe("/usr/bin/osascript");
    expect(args).toContain("--");
    expect(args.at(-1)).toContain(input.unitRef);
    expect(args.at(-1)).toContain("ONAYLA");
    expect(args.at(-1)).toContain("Meta üzerinde değişiklik veya execute yapmaz");
    expect(options).not.toHaveProperty("shell");
  });

  it("fails closed on cancel, timeout, unsupported host, or malformed unit", async () => {
    const cancelled = vi.fn(async (_file: string, _args: readonly string[], _options: Readonly<{
      timeout: number; maxBuffer: number; encoding: "utf8";
    }>) => { throw new Error("cancelled"); });
    await expect(new MacOsHumanPresenceCeremony(cancelled, "darwin").confirm(input)).resolves.toBe(false);
    const run = vi.fn(async (_file: string, _args: readonly string[], _options: Readonly<{
      timeout: number; maxBuffer: number; encoding: "utf8";
    }>) => ({ stdout: "confirmed\n" }));
    await expect(new MacOsHumanPresenceCeremony(run, "linux").confirm(input)).resolves.toBe(false);
    await expect(new MacOsHumanPresenceCeremony(run, "darwin").confirm({ ...input, unitRef: "act_12345" })).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("renders an exact policy-publication warning without exposing policy payloads", async () => {
    const run = vi.fn(async (_file: string, _args: readonly string[], _options: Readonly<{
      timeout: number; maxBuffer: number; encoding: "utf8";
    }>) => ({ stdout: "confirmed\n" }));
    await expect(new MacOsHumanPresenceCeremony(run, "darwin").confirm({ ...input,
      unitRef: "policy_unit_bbbbbbbbbbbbbbbbbbbb", action: "publish_approval_policy" })).resolves.toBe(true);
    const message = run.mock.calls[0]![1].at(-1)!;
    expect(message).toContain("ONAY POLİTİKASINI YAYINLA");
    expect(message).toContain("Meta üzerinde değişiklik veya execute yapmaz");
    expect(message).not.toMatch(/canonical|payload|targeting/i);
  });
});
