/**
 * Read-only naming audit for a Meta hierarchy.
 *
 * Names are treated as claims, never as source-of-truth configuration. A
 * caller supplies the already-read configured targeting and observed delivery
 * summaries; this module only produces an auditable rename proposal.
 */
export const LIVE_NAMING_IDENTITY_AUDIT_VERSION = "live-naming-identity-audit/1.0.0" as const;

export type NamingAuditStatus = "verified" | "mismatch" | "unknown";
export type NamingAuditSeverity = "correction_required" | "review_required" | "information";

export type NamingAuditFinding = Readonly<{
  facet: "service" | "campaign_family" | "route" | "language" | "objective" | "country_targeting" | "operating_system" | "publisher_platform" | "delivery_country";
  status: NamingAuditStatus;
  severity: NamingAuditSeverity;
  detail: string;
}>;

export type CampaignNamingIdentityInput = Readonly<{
  name: string;
  configuredObjective: "OUTCOME_LEADS" | "OUTCOME_ENGAGEMENT" | "OUTCOME_AWARENESS" | "unknown";
  expected: Readonly<{
    service?: "physical_therapy_rehab";
    campaignFamily?: "intensive_ftr";
    route?: "whatsapp" | "lead_form";
    language?: "ar" | "ru" | "tr" | "en";
  }>;
}>;

export type AdSetNamingIdentityInput = Readonly<{
  name: string;
  configuredTargeting: Readonly<{
    countryCodes: readonly string[];
    userOperatingSystem: "ios" | "android" | "all_platforms" | "unknown";
    publisherPlatforms: readonly ("facebook" | "instagram")[] | null;
  }>;
  observedDelivery: Readonly<{
    countryCodes: readonly string[];
    platformBreakdown: readonly ("mobile_app" | "mobile_web" | "desktop" | "unknown")[];
  }>;
  expected: Readonly<{ route?: "whatsapp" | "lead_form"; audienceStrategy?: string }>;
}>;

export type AdNamingIdentityInput = Readonly<{
  name: string;
  expected: Readonly<{ language?: "ar" | "ru" | "tr" | "en"; creativeFamily?: string }>;
}>;

export type NamingIdentityAudit = Readonly<{
  version: typeof LIVE_NAMING_IDENTITY_AUDIT_VERSION;
  entityType: "campaign" | "ad_set" | "ad";
  observedName: string;
  findings: readonly NamingAuditFinding[];
  status: NamingAuditStatus;
  suggestedName: string | null;
  requiresHumanReview: true;
  authority: Readonly<{
    canRename: false;
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
}>;

const AUTHORITY = Object.freeze({ canRename: false as const, canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const });

const COUNTRIES = Object.freeze([
  ["AE", "BAE", ["bae", "birlesik arap emirlikleri"]],
  ["BH", "Bahreyn", ["bahreyn"]],
  ["BY", "Belarus", ["belarus"]],
  ["GE", "Gürcistan", ["gurcistan", "gürcistan"]],
  ["KG", "Kırgızistan", ["kirgizistan", "kırgızistan"]],
  ["KW", "Kuveyt", ["kuveyt"]],
  ["KZ", "Kazakistan", ["kazakistan"]],
  ["OM", "Umman", ["umman"]],
  ["QA", "Katar", ["katar"]],
  ["TJ", "Tacikistan", ["tacikistan"]],
  ["UZ", "Özbekistan", ["ozbekistan", "özbekistan"]],
] as const);

function normalized(value: string): string {
  // Campaign labels mix Turkish and English tokens. Locale-sensitive Turkish
  // lowercasing would turn `Intensive` into `ıntensive`, while a supplied
  // canonical `intensive_ftr` remains dotted; normalize identity tokens in a
  // locale-neutral form before comparing them.
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function hasToken(name: string, token: string): boolean {
  return normalized(name).includes(normalized(token));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function finding(facet: NamingAuditFinding["facet"], status: NamingAuditStatus, severity: NamingAuditSeverity, detail: string): NamingAuditFinding {
  return Object.freeze({ facet, status, severity, detail });
}

function auditStatus(findings: readonly NamingAuditFinding[]): NamingAuditStatus {
  if (findings.some((item) => item.status === "mismatch")) return "mismatch";
  if (findings.some((item) => item.status === "unknown")) return "unknown";
  return "verified";
}

function finalize(entityType: NamingIdentityAudit["entityType"], observedName: string, findings: readonly NamingAuditFinding[], suggestedName: string | null): NamingIdentityAudit {
  return Object.freeze({ version: LIVE_NAMING_IDENTITY_AUDIT_VERSION, entityType, observedName,
    findings: Object.freeze([...findings]), status: auditStatus(findings), suggestedName,
    requiresHumanReview: true, authority: AUTHORITY });
}

function namedCountryCodes(name: string): string[] {
  return COUNTRIES.filter(([, , aliases]) => aliases.some((alias) => hasToken(name, alias))).map(([code]) => code);
}

function countryLabel(code: string): string {
  return COUNTRIES.find(([candidate]) => candidate === code)?.[1] ?? code;
}

function expectedRouteFinding(name: string, route: CampaignNamingIdentityInput["expected"]["route"]): NamingAuditFinding | null {
  if (!route) return null;
  const routeToken = route === "whatsapp" ? "whatsapp" : "lead";
  const claimsRoute = hasToken(name, routeToken);
  const startsWithRoute = new RegExp(`^\\s*${routeToken}\\b`, "iu").test(name);
  if (startsWithRoute) return finding("route", "mismatch", "correction_required",
    "Dönüşüm rotası kampanya adının ana kimliği olamaz; rota canlı kurulum ve ölçüm alanında tutulmalıdır.");
  if (claimsRoute) return finding("route", "verified", "information", "İsim rota bilgisini ikincil tanım olarak taşıyor; ana kimlik hizmet ve kampanya ailesidir.");
  return finding("route", "unknown", "information", "Kampanya adı rota bilgisini taşımıyor; rota yalnız canlı kurulumdan doğrulanmalıdır.");
}

/** Audits only explicit campaign-name claims against configured objective and reviewed expected identity. */
export function auditCampaignNamingIdentity(input: CampaignNamingIdentityInput): NamingIdentityAudit {
  const findings: NamingAuditFinding[] = [];
  const serviceMatches = input.expected.service !== "physical_therapy_rehab" || hasToken(input.name, "ftr") || hasToken(input.name, "fizik tedavi");
  if (input.expected.service) findings.push(finding("service", serviceMatches ? "verified" : "mismatch", serviceMatches ? "information" : "correction_required",
    serviceMatches ? "İsim fizik tedavi / rehabilitasyon hizmet iddiasını taşıyor." : "İsim beklenen fizik tedavi / rehabilitasyon hizmet iddiasını taşımıyor."));
  if (input.expected.campaignFamily) {
    const familyMatches = input.expected.campaignFamily !== "intensive_ftr" || hasToken(input.name, "intensive ftr");
    findings.push(finding("campaign_family", familyMatches ? "verified" : "mismatch", familyMatches ? "information" : "correction_required",
      familyMatches ? "İsim Intensive FTR kampanya ailesini taşıyor." : "İsim beklenen Intensive FTR kampanya ailesini taşımıyor."));
  }
  const route = expectedRouteFinding(input.name, input.expected.route);
  if (route) findings.push(route);
  if (input.expected.language) {
    const languageMatches = hasToken(input.name, input.expected.language.toUpperCase());
    findings.push(finding("language", languageMatches ? "verified" : "mismatch", languageMatches ? "information" : "correction_required",
      languageMatches ? `İsim ${input.expected.language.toUpperCase()} dil etiketini taşıyor.` : `İsim ${input.expected.language.toUpperCase()} dil etiketini taşımıyor.`));
  }
  const objectiveClaimedAsLead = hasToken(input.name, "lead");
  if (objectiveClaimedAsLead) {
    const matches = input.configuredObjective === "OUTCOME_LEADS";
    findings.push(finding("objective", matches ? "verified" : "mismatch", matches ? "information" : "correction_required",
      matches ? "İsimdeki lead iddiası canlı kampanya objective'i ile uyumlu." : "İsimdeki lead iddiası canlı kampanya objective'i ile uyumsuz."));
  } else {
    findings.push(finding("objective", "unknown", "review_required", "İsim objective iddiası taşımıyor; canlı objective isimden türetilemez."));
  }
  const routePrimary = input.expected.route && new RegExp(`^\\s*${input.expected.route === "whatsapp" ? "whatsapp" : "lead"}\\b`, "iu").test(input.name);
  const suggestedName = routePrimary && input.expected.service === "physical_therapy_rehab" && input.expected.campaignFamily === "intensive_ftr"
    ? "Fizik Tedavi · Intensive FTR"
    : auditStatus(findings) === "mismatch" ? input.name : null;
  return finalize("campaign", input.name, findings, suggestedName);
}

/**
 * Checks country and operating-system claims in an ad-set name. Publisher
 * placement is never inferred from the name; absent live configuration stays
 * unknown. Observed delivery is evidence for review, not a targeting rewrite.
 */
export function auditAdSetNamingIdentity(input: AdSetNamingIdentityInput): NamingIdentityAudit {
  const findings: NamingAuditFinding[] = [];
  const namedCountries = uniqueSorted(namedCountryCodes(input.name));
  const configuredCountries = uniqueSorted(input.configuredTargeting.countryCodes);
  const countriesMatch = namedCountries.length > 0 && namedCountries.join("|") === configuredCountries.join("|");
  findings.push(finding("country_targeting", countriesMatch ? "verified" : "mismatch", countriesMatch ? "information" : "correction_required",
    countriesMatch ? "İsimdeki ülke kümesi canlı hedefleme ile eşleşiyor." : `İsim ülke kümesi ${namedCountries.join(", ") || "yok"}; canlı hedefleme ${configuredCountries.join(", ") || "yok"}.`));

  const namedOperatingSystem = hasToken(input.name, "ios") ? "ios" : hasToken(input.name, "android") ? "android" : "unknown";
  const configuredOperatingSystem = input.configuredTargeting.userOperatingSystem;
  const operatingSystemMatches = configuredOperatingSystem === "all_platforms"
    ? namedOperatingSystem === "unknown"
    : namedOperatingSystem === configuredOperatingSystem;
  findings.push(finding("operating_system", operatingSystemMatches ? "verified" : "mismatch", operatingSystemMatches ? "information" : "correction_required",
    operatingSystemMatches ? "İsimdeki işletim sistemi canlı hedefleme ile eşleşiyor." : `İsim işletim sistemi ${namedOperatingSystem}; canlı hedefleme ${configuredOperatingSystem}.`));

  const route = expectedRouteFinding(input.name, input.expected.route);
  if (route) findings.push(route);
  if (input.expected.audienceStrategy) {
    const matches = hasToken(input.name, input.expected.audienceStrategy);
    findings.push(finding("service", matches ? "verified" : "unknown", matches ? "information" : "review_required",
      matches ? `İsim ${input.expected.audienceStrategy} hedefleme etiketini taşıyor.` : `İsim ${input.expected.audienceStrategy} hedefleme etiketini açıkça taşımıyor; canlı hedefleme kuralı ayrıca doğrulanmalı.`));
  }
  findings.push(finding("publisher_platform", input.configuredTargeting.publisherPlatforms === null ? "unknown" : "verified",
    input.configuredTargeting.publisherPlatforms === null ? "review_required" : "information",
    input.configuredTargeting.publisherPlatforms === null ? "Canlı publisher platform hedeflemesi alınamadı; isimden varsayım yapılmadı." : "Publisher platform hedeflemesi canlı kurulumdan doğrulandı; isimden türetilmedi."));
  const deliveryCountries = uniqueSorted(input.observedDelivery.countryCodes.filter((code) => code !== "unknown"));
  const deliveryOutsideTarget = deliveryCountries.filter((code) => !configuredCountries.includes(code));
  findings.push(finding("delivery_country", deliveryOutsideTarget.length === 0 ? "verified" : "mismatch",
    deliveryOutsideTarget.length === 0 ? "information" : "review_required",
    deliveryOutsideTarget.length === 0 ? "Gözlenen teslimat ülkeleri hedefleme kümesinin dışında görünmüyor." : `Gözlenen teslimat hedefleme dışında: ${deliveryOutsideTarget.join(", ")}.`));

  const status = auditStatus(findings);
  const suggestedName = status === "mismatch"
    ? `${configuredCountries.map(countryLabel).join(" + ")} · ${input.expected.route === "whatsapp" ? "WhatsApp" : input.expected.route === "lead_form" ? "Lead" : "Rota bilinmiyor"} · ${configuredOperatingSystem === "ios" ? "iOS" : configuredOperatingSystem === "android" ? "Android" : "Tüm platformlar"}${input.expected.audienceStrategy ? ` · ${input.expected.audienceStrategy}` : ""}`
    : null;
  return finalize("ad_set", input.name, findings, suggestedName);
}

/**
 * An ad label may be terse, but a bare ordinal/copy chain cannot prove which
 * creative is active. We deliberately do not manufacture a replacement label
 * without a reviewed creative asset identity.
 */
export function auditAdNamingIdentity(input: AdNamingIdentityInput): NamingIdentityAudit {
  const findings: NamingAuditFinding[] = [];
  const compact = input.name.trim();
  const bareCopyChain = /^\d+(?:\s*-\s*kopya)*$/iu.test(compact);
  const hasCreativeIdentity = /[\p{L}]{3,}/u.test(compact.replace(/kopya/giu, ""));
  findings.push(finding("service", bareCopyChain || !hasCreativeIdentity ? "mismatch" : "verified",
    bareCopyChain || !hasCreativeIdentity ? "correction_required" : "information",
    bareCopyChain || !hasCreativeIdentity
      ? "Reklam adı yalnız sıra/kopya zinciri; yaratıcı veya içerik kimliği doğrulanamıyor."
      : "Reklam adı ayırt edilebilir bir yaratıcı/içerik kimliği taşıyor."));
  if (input.expected.language) {
    const matches = hasToken(compact, input.expected.language.toUpperCase());
    findings.push(finding("language", matches ? "verified" : "unknown", matches ? "information" : "review_required",
      matches ? `Reklam adı ${input.expected.language.toUpperCase()} dil etiketini taşıyor.` : "Reklam adı dil etiketini taşımıyor; varlık metni veya dil sinyaliyle doğrulama gerekir."));
  }
  if (input.expected.creativeFamily) {
    const matches = hasToken(compact, input.expected.creativeFamily);
    findings.push(finding("route", matches ? "verified" : "unknown", matches ? "information" : "review_required",
      matches ? `Reklam adı ${input.expected.creativeFamily} yaratıcı ailesini taşıyor.` : "Yaratıcı aile etiketi isimden doğrulanamadı."));
  }
  return finalize("ad", input.name, findings, null);
}
