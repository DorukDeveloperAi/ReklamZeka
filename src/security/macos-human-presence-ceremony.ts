import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
import type { HumanPresenceAction } from "@/security/human-presence-challenge";

const UNIT_REF = /^(?:action|policy)_unit_[a-f0-9]{20}$/;
const ACTION_LABELS = Object.freeze({
  approve: "ONAYLA",
  reject: "REDDET",
  request_changes: "DEĞİŞİKLİK İSTE",
  admit_execution: "UYGULAMA ADIMINI HAZIRLA",
  publish_approval_policy: "ONAY POLİTİKASINI YAYINLA",
  publish_guardrail_policy: "KORUMA POLİTİKASINI YAYINLA",
});

/**
 * macOS-owned modal confirmation. No shell is used and only the public
 * ActionUnit reference enters the prompt. Cancel, timeout, or a non-macOS host
 * fails closed and never mints a presence proof.
 */
export type HumanPresenceConfirmationInput = Readonly<{
  request: Request;
  workspaceId: string;
  actorRef: string;
  unitRef: string;
  action: HumanPresenceAction;
}>;
type CeremonyRunner = (file: string, args: readonly string[], options: Readonly<{
  timeout: number;
  maxBuffer: number;
  encoding: "utf8";
}>) => Promise<Readonly<{ stdout: string }>>;

export class MacOsHumanPresenceCeremony {
  constructor(private readonly run: CeremonyRunner = async (file, args, options) => {
    const result = await executeFile(file, [...args], options);
    return { stdout: result.stdout };
  }, private readonly platform: NodeJS.Platform = process.platform) {}

  async confirm(input: HumanPresenceConfirmationInput): Promise<boolean> {
    if (this.platform !== "darwin" || !UNIT_REF.test(input.unitRef)
      || !Object.hasOwn(ACTION_LABELS, input.action)) return false;
    const action = ACTION_LABELS[input.action];
    const message = [
      "ReklamZeka karar kaydı",
      "",
      `ActionUnit: ${input.unitRef}`,
      `Karar: ${action}`,
      "",
      "Bu işlem yalnız uygulama-admission kaydı oluşturur.",
      "Meta üzerinde değişiklik veya execute yapmaz.",
    ].join("\n");
    try {
      const script = [
        "on run argv",
        "display dialog (item 1 of argv) with title \"ReklamZeka · İnsan Onayı\" buttons {\"Vazgeç\", \"Kararı doğrula\"} default button \"Kararı doğrula\" cancel button \"Vazgeç\" with icon caution",
        "return \"confirmed\"",
        "end run",
      ].join("\n");
      const result = await this.run("/usr/bin/osascript", ["-e", script, "--", message], {
        timeout: 120_000,
        maxBuffer: 1_024,
        encoding: "utf8",
      });
      return result.stdout.trim() === "confirmed";
    } catch {
      return false;
    }
  }
}
