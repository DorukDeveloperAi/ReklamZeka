import {
  isValidIanaTimezone,
  type AnalysisComparison,
  type AnalysisTimeframe,
} from "./schema";

export const TIMEFRAME_RESOLVER_VERSION = "analysis-timeframe-resolver/1.0.0" as const;

export type InclusiveDateWindow = Readonly<{
  startDate: string;
  endDate: string;
}>;

export type TimeframeAnchors = Readonly<{
  lifetime?: Readonly<{ startDate: string; endDate?: string }>;
  learning?: Readonly<{ startDate: string; endDate?: string }>;
  action?: Readonly<{ occurredAt: string }>;
}>;

export type ResolvedAnalysisTimeframe = Readonly<{
  resolverVersion: typeof TIMEFRAME_RESOLVER_VERSION;
  kind: AnalysisTimeframe["kind"];
  timezone: string;
  asOfDate: string;
  startDate: string;
  endDate: string;
  inclusiveDayCount: number;
  comparisonPolicy: AnalysisComparison;
  comparisonStartDate: string | null;
  comparisonEndDate: string | null;
}>;

export type TimeframeResolutionErrorCode =
  | "invalid_as_of"
  | "invalid_timezone"
  | "invalid_date"
  | "invalid_range"
  | "missing_anchor"
  | "future_anchor";

export class TimeframeResolutionError extends Error {
  constructor(readonly code: TimeframeResolutionErrorCode, message: string) {
    super(message);
    this.name = "TimeframeResolutionError";
  }
}

const TIMEFRAME_KINDS: readonly AnalysisTimeframe["kind"][] = [
  "rolling",
  "fixed",
  "calendar",
  "lifetime",
  "learning",
  "action_relative",
];
const COMPARISON_POLICIES: readonly AnalysisComparison[] = ["previous_period", "previous_year", "weekday_matched", "none"];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

function parseDate(value: string): Date {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new TimeframeResolutionError("invalid_date", `Geçersiz takvim tarihi: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TimeframeResolutionError("invalid_date", `Geçersiz takvim tarihi: ${value}`);
  }
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function inclusiveDays(window: InclusiveDateWindow): number {
  return Math.round((parseDate(window.endDate).getTime() - parseDate(window.startDate).getTime()) / DAY_MS) + 1;
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function localDateAt(instant: string, timezone: string): string {
  if (!INSTANT_PATTERN.test(instant) || !Number.isFinite(Date.parse(instant))) {
    throw new TimeframeResolutionError("invalid_as_of", "Zonelu geçerli bir ISO instant zorunludur");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validateWindow(window: InclusiveDateWindow, label: string): InclusiveDateWindow {
  parseDate(window.startDate);
  parseDate(window.endDate);
  if (window.startDate > window.endDate) throw new TimeframeResolutionError("invalid_range", `${label} başlangıcı bitişinden sonra olamaz`);
  return window;
}

function anchoredWindow(
  anchor: Readonly<{ startDate: string; endDate?: string }> | undefined,
  asOfDate: string,
  label: "lifetime" | "learning",
): InclusiveDateWindow {
  if (!anchor) throw new TimeframeResolutionError("missing_anchor", `${label} timeframe için anchor zorunludur`);
  parseDate(anchor.startDate);
  if (anchor.endDate) parseDate(anchor.endDate);
  if (anchor.startDate > asOfDate) throw new TimeframeResolutionError("future_anchor", `${label} başlangıcı asOf tarihinden sonra olamaz`);
  const endDate = anchor.endDate ? minDate(anchor.endDate, asOfDate) : asOfDate;
  return validateWindow({ startDate: anchor.startDate, endDate }, label);
}

function calendarWindow(timeframe: Extract<AnalysisTimeframe, { kind: "calendar" }>, asOfDate: string): InclusiveDateWindow {
  const asOf = parseDate(asOfDate);
  if (timeframe.unit === "week") {
    const mondayOffset = (asOf.getUTCDay() + 6) % 7;
    const currentMonday = addDays(asOfDate, -mondayOffset);
    const startDate = addDays(currentMonday, timeframe.offset * 7);
    return { startDate, endDate: minDate(addDays(startDate, 6), asOfDate) };
  }

  const monthsPerUnit = timeframe.unit === "month" ? 1 : 3;
  const currentUnitMonth = timeframe.unit === "month"
    ? asOf.getUTCMonth()
    : Math.floor(asOf.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), currentUnitMonth + timeframe.offset * monthsPerUnit, 1));
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthsPerUnit, 1));
  const startDate = formatDate(start);
  const endDate = minDate(formatDate(new Date(next.getTime() - DAY_MS)), asOfDate);
  return { startDate, endDate };
}

function actionWindow(
  timeframe: Extract<AnalysisTimeframe, { kind: "action_relative" }>,
  anchor: TimeframeAnchors["action"],
  asOfDate: string,
): InclusiveDateWindow {
  if (!anchor) {
    throw new TimeframeResolutionError("missing_anchor", "action-relative timeframe için geçerli action anchor zorunludur");
  }
  let actionDate: string;
  try {
    actionDate = localDateAt(anchor.occurredAt, timeframe.timezone);
  } catch {
    throw new TimeframeResolutionError("missing_anchor", "action-relative timeframe için geçerli action anchor zorunludur");
  }
  if (actionDate > asOfDate) throw new TimeframeResolutionError("future_anchor", "Action asOf tarihinden sonra olamaz");
  return {
    startDate: addDays(actionDate, -timeframe.beforeDays),
    endDate: minDate(addDays(actionDate, timeframe.afterDays), asOfDate),
  };
}

function subtractYear(value: string): string {
  const date = parseDate(value);
  const year = date.getUTCFullYear() - 1;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDate(new Date(Date.UTC(year, month, Math.min(day, maxDay))));
}

function comparisonWindow(window: InclusiveDateWindow, policy: AnalysisComparison): InclusiveDateWindow | null {
  if (policy === "none") return null;
  if (policy === "previous_year") {
    return { startDate: subtractYear(window.startDate), endDate: subtractYear(window.endDate) };
  }
  const days = inclusiveDays(window);
  const shift = policy === "weekday_matched" ? Math.ceil(days / 7) * 7 : days;
  return { startDate: addDays(window.startDate, -shift), endDate: addDays(window.endDate, -shift) };
}

export function validateResolvedAnalysisTimeframe(value: ResolvedAnalysisTimeframe): ResolvedAnalysisTimeframe {
  const allowedKeys = [
    "resolverVersion",
    "kind",
    "timezone",
    "asOfDate",
    "startDate",
    "endDate",
    "inclusiveDayCount",
    "comparisonPolicy",
    "comparisonStartDate",
    "comparisonEndDate",
  ];
  const unexpectedKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpectedKeys.length > 0) throw new TimeframeResolutionError("invalid_range", `Resolved timeframe bilinmeyen alan taşıyor: ${unexpectedKeys.join(", ")}`);
  if (value.resolverVersion !== TIMEFRAME_RESOLVER_VERSION) {
    throw new TimeframeResolutionError("invalid_range", "Resolved timeframe resolver sürümü geçersizdir");
  }
  if (!TIMEFRAME_KINDS.includes(value.kind)) throw new TimeframeResolutionError("invalid_range", "Resolved timeframe kind geçersizdir");
  if (!COMPARISON_POLICIES.includes(value.comparisonPolicy)) throw new TimeframeResolutionError("invalid_range", "Resolved timeframe comparison policy geçersizdir");
  if (!isValidIanaTimezone(value.timezone)) throw new TimeframeResolutionError("invalid_timezone", "Resolved timeframe timezone geçersizdir");
  parseDate(value.asOfDate);
  const primary = validateWindow({ startDate: value.startDate, endDate: value.endDate }, "resolved timeframe");
  if (primary.endDate > value.asOfDate) throw new TimeframeResolutionError("future_anchor", "Resolved timeframe asOf sonrasını kapsayamaz");
  if (!Number.isInteger(value.inclusiveDayCount) || value.inclusiveDayCount !== inclusiveDays(primary)) {
    throw new TimeframeResolutionError("invalid_range", "Resolved timeframe inclusiveDayCount ile tarih aralığı uyuşmuyor");
  }

  const expectedComparison = comparisonWindow(primary, value.comparisonPolicy);
  if (expectedComparison === null) {
    if (value.comparisonStartDate !== null || value.comparisonEndDate !== null) {
      throw new TimeframeResolutionError("invalid_range", "none comparison tarih taşıyamaz");
    }
  } else {
    if (value.comparisonStartDate === null || value.comparisonEndDate === null) {
      throw new TimeframeResolutionError("invalid_range", "Comparison politikası iki tarih de taşımalıdır");
    }
    validateWindow({ startDate: value.comparisonStartDate, endDate: value.comparisonEndDate }, "resolved comparison");
    if (value.comparisonStartDate !== expectedComparison.startDate || value.comparisonEndDate !== expectedComparison.endDate) {
      throw new TimeframeResolutionError("invalid_range", "Comparison tarihleri seçilen politikayla uyuşmuyor");
    }
  }
  return value;
}

export function resolveAnalysisTimeframe(input: Readonly<{
  timeframe: AnalysisTimeframe;
  comparison: AnalysisComparison;
  asOf: string;
  anchors?: TimeframeAnchors;
}>): ResolvedAnalysisTimeframe {
  if (!isValidIanaTimezone(input.timeframe.timezone)) {
    throw new TimeframeResolutionError("invalid_timezone", "Timeframe geçerli bir IANA timezone taşımalıdır");
  }
  if (!COMPARISON_POLICIES.includes(input.comparison)) {
    throw new TimeframeResolutionError("invalid_range", "Karşılaştırma politikası geçersizdir");
  }
  if (input.timeframe.kind === "rolling" &&
      (!Number.isInteger(input.timeframe.days) || input.timeframe.days < 1 || input.timeframe.days > 365)) {
    throw new TimeframeResolutionError("invalid_range", "Rolling timeframe 1–365 gün olmalıdır");
  }
  if (input.timeframe.kind === "calendar" &&
      (!Number.isInteger(input.timeframe.offset) || input.timeframe.offset > 0 || input.timeframe.offset < -24)) {
    throw new TimeframeResolutionError("invalid_range", "Calendar offset -24–0 aralığında olmalıdır");
  }
  if (input.timeframe.kind === "action_relative" &&
      (!Number.isInteger(input.timeframe.beforeDays) || input.timeframe.beforeDays < 0 || input.timeframe.beforeDays > 365 ||
       !Number.isInteger(input.timeframe.afterDays) || input.timeframe.afterDays < 0 || input.timeframe.afterDays > 365 ||
       input.timeframe.beforeDays + input.timeframe.afterDays < 1)) {
    throw new TimeframeResolutionError("invalid_range", "Action-relative günleri 0–365 aralığında ve toplamda pozitif olmalıdır");
  }
  const asOfDate = localDateAt(input.asOf, input.timeframe.timezone);
  let primary: InclusiveDateWindow;
  switch (input.timeframe.kind) {
    case "rolling":
      primary = { startDate: addDays(asOfDate, -(input.timeframe.days - 1)), endDate: asOfDate };
      break;
    case "fixed":
      primary = validateWindow({ startDate: input.timeframe.startDate, endDate: input.timeframe.endDate }, "fixed");
      if (primary.endDate > asOfDate) throw new TimeframeResolutionError("future_anchor", "Fixed timeframe asOf sonrasını kapsayamaz");
      break;
    case "calendar":
      primary = calendarWindow(input.timeframe, asOfDate);
      break;
    case "lifetime":
      primary = anchoredWindow(input.anchors?.lifetime, asOfDate, "lifetime");
      break;
    case "learning":
      primary = anchoredWindow(input.anchors?.learning, asOfDate, "learning");
      break;
    case "action_relative":
      primary = actionWindow(input.timeframe, input.anchors?.action, asOfDate);
      break;
  }
  primary = validateWindow(primary, input.timeframe.kind);
  const comparison = comparisonWindow(primary, input.comparison);
  return Object.freeze(validateResolvedAnalysisTimeframe({
    resolverVersion: TIMEFRAME_RESOLVER_VERSION,
    kind: input.timeframe.kind,
    timezone: input.timeframe.timezone,
    asOfDate,
    startDate: primary.startDate,
    endDate: primary.endDate,
    inclusiveDayCount: inclusiveDays(primary),
    comparisonPolicy: input.comparison,
    comparisonStartDate: comparison?.startDate ?? null,
    comparisonEndDate: comparison?.endDate ?? null,
  }));
}
