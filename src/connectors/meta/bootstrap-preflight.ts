export type MetaBootstrapPreflightBlocker =
  | "rotation_required"
  | "explicit_security_status_required"
  | "secret_binding_missing";

export type MetaBootstrapPreflight = Readonly<{
  schemaVersion: 1;
  phase: "preflight";
  accessMode: "read_only";
  readiness: "configured" | "blocked";
  blocker: MetaBootstrapPreflightBlocker | null;
  securityStatus: "temporary_exposed" | "secure" | "unknown";
  secretBindingConfigured: boolean;
  doctorExecuted: false;
  bootstrapExecuted: false;
  networkCalls: 0;
  writeOperations: 0;
  message: string;
  nextStep: string;
}>;

type MetaBootstrapEnvironment = Readonly<Record<string, string | undefined>>;

const SECURE_STATUS_VALUES = new Set(["secure", "rotated", "standard"]);

function hasSecretBinding(environment: MetaBootstrapEnvironment): boolean {
  // Presence is intentionally checked without reading the secret value.
  return Object.prototype.hasOwnProperty.call(environment, "META_ACCESS_TOKEN");
}

export function metaTokenSecurityBlocksDoctor(status: string | undefined): boolean {
  return status?.trim().toLowerCase() === "temporary_exposed";
}

export function inspectMetaBootstrapPreflight(
  environment: MetaBootstrapEnvironment = process.env,
): MetaBootstrapPreflight {
  const rawStatus = environment.META_TOKEN_SECURITY_STATUS?.trim().toLowerCase();
  const secretBindingConfigured = hasSecretBinding(environment);

  if (rawStatus === "temporary_exposed") {
    return Object.freeze({
      schemaVersion: 1,
      phase: "preflight",
      accessMode: "read_only",
      readiness: "blocked",
      blocker: "rotation_required",
      securityStatus: "temporary_exposed",
      secretBindingConfigured,
      doctorExecuted: false,
      bootstrapExecuted: false,
      networkCalls: 0,
      writeOperations: 0,
      message: "Meta bağlantısı güvenlik nedeniyle kapalı; mevcut kimlik bilgisi kullanılmayacak.",
      nextStep: "Tokenı Meta tarafında döndürün, yeni secret binding'i tanımlayın ve META_TOKEN_SECURITY_STATUS=rotated olarak işaretleyin.",
    });
  }

  if (!rawStatus || !SECURE_STATUS_VALUES.has(rawStatus)) {
    return Object.freeze({
      schemaVersion: 1,
      phase: "preflight",
      accessMode: "read_only",
      readiness: "blocked",
      blocker: "explicit_security_status_required",
      securityStatus: "unknown",
      secretBindingConfigured,
      doctorExecuted: false,
      bootstrapExecuted: false,
      networkCalls: 0,
      writeOperations: 0,
      message: "Meta güvenlik durumu açıkça doğrulanmadığı için bağlantı preflight'ı kapalı.",
      nextStep: "Rotasyonu doğrulayın ve META_TOKEN_SECURITY_STATUS=rotated olarak işaretleyin.",
    });
  }

  if (!secretBindingConfigured) {
    return Object.freeze({
      schemaVersion: 1,
      phase: "preflight",
      accessMode: "read_only",
      readiness: "blocked",
      blocker: "secret_binding_missing",
      securityStatus: "secure",
      secretBindingConfigured: false,
      doctorExecuted: false,
      bootstrapExecuted: false,
      networkCalls: 0,
      writeOperations: 0,
      message: "Güvenlik durumu doğrulandı; Meta secret binding henüz yapılandırılmadı.",
      nextStep: "Yeni tokenı yalnız server-side META_ACCESS_TOKEN secret binding'ine ekleyin.",
    });
  }

  return Object.freeze({
    schemaVersion: 1,
    phase: "preflight",
    accessMode: "read_only",
    readiness: "configured",
    blocker: null,
    securityStatus: "secure",
    secretBindingConfigured: true,
    doctorExecuted: false,
    bootstrapExecuted: false,
    networkCalls: 0,
    writeOperations: 0,
    message: "Salt-okunur Meta doctor için güvenli yapılandırma mevcut.",
    nextStep: "Yetkili doctor akışını çalıştırın; başarılı doctor kanıtı olmadan bootstrap veya sync başlatmayın.",
  });
}
