import {
  CANONICAL_AD_METRIC_VERSION,
  decimalMoneyToMinor,
  validateCanonicalMetric,
  type Attribution,
  type CanonicalDailyMetric,
} from "@/domain/ads/canonical";
import { ConnectorError, type ConnectorPage, type ReadOnlyAdConnector, type SourceRecord } from "./contract";

export type CsvAdRow = Readonly<{
  source_row_id: string;
  source_updated_at: string;
  account_id: string;
  account_name: string;
  campaign_id: string;
  campaign_name: string;
  metric_date: string;
  currency: string;
  timezone: string;
  attribution_model: Attribution["model"];
  attribution_click_days: string;
  attribution_view_days: string;
  spend: string;
  impressions: string;
  clicks: string;
  conversions: string;
  conversion_value: string;
}>;

const REQUIRED_COLUMNS = [
  "source_row_id", "source_updated_at", "account_id", "account_name", "campaign_id",
  "campaign_name", "metric_date", "currency", "timezone", "attribution_model",
  "attribution_click_days", "attribution_view_days", "spend", "impressions", "clicks",
  "conversions", "conversion_value",
] as const;

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }

  if (quoted) throw new ConnectorError("invalid_data", "CSV içinde kapanmamış tırnak var", false);
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function csvRecords(csv: string): CsvAdRow[] {
  const rows = parseCsvRows(csv.replace(/^\uFEFF/, ""));
  const header = rows.shift();
  if (!header) throw new ConnectorError("invalid_data", "CSV başlığı bulunamadı", false);

  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) throw new ConnectorError("invalid_data", `CSV sütunu eksik: ${column}`, false);
  }

  return rows.map((values, rowIndex) => {
    if (values.length !== header.length) {
      throw new ConnectorError("invalid_data", `CSV satır ${rowIndex + 2} sütun sayısı geçersiz`, false);
    }
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])) as CsvAdRow;
  });
}

function nonNegative(value: string, field: string, integer = true): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isSafeInteger(parsed))) {
    throw new ConnectorError("invalid_data", `${field} geçersiz`, false);
  }
  return parsed;
}

export class CsvAdConnector implements ReadOnlyAdConnector<CsvAdRow> {
  readonly platform = "csv" as const;
  readonly access = "read_only" as const;
  readonly rateLimit = { maxRequests: 1_000, windowMs: 1_000 } as const;
  private readonly rows: readonly CsvAdRow[];

  constructor(csv: string, private readonly pageSize = 500) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new ConnectorError("invalid_data", "CSV pageSize pozitif tam sayı olmalıdır", false);
    }
    this.rows = csvRecords(csv);
  }

  async fetchPage(cursor?: string): Promise<ConnectorPage<CsvAdRow>> {
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new ConnectorError("invalid_data", `Geçersiz CSV cursor: ${cursor}`, false);
    }
    const slice = this.rows.slice(offset, offset + this.pageSize);
    const records = slice.map((payload): SourceRecord<CsvAdRow> => ({
      id: payload.source_row_id,
      updatedAt: payload.source_updated_at,
      payload,
    }));
    const nextOffset = offset + records.length;
    return {
      records,
      nextCursor: nextOffset < this.rows.length ? String(nextOffset) : undefined,
      observedAt: new Date().toISOString(),
    };
  }

  toCanonical(record: SourceRecord<CsvAdRow>, workspaceId: string): CanonicalDailyMetric {
    const row = record.payload;
    if (!(["platform_default", "last_click", "data_driven"] as const).includes(row.attribution_model)) {
      throw new ConnectorError("invalid_data", "attribution_model geçersiz", false);
    }
    return validateCanonicalMetric({
      schemaVersion: CANONICAL_AD_METRIC_VERSION,
      workspaceId,
      platform: this.platform,
      sourceAccountId: row.account_id,
      sourceCampaignId: row.campaign_id,
      sourceRowId: record.id,
      sourceUpdatedAt: record.updatedAt,
      accountName: row.account_name,
      campaignName: row.campaign_name,
      metricDate: row.metric_date,
      currency: row.currency,
      timezone: row.timezone,
      attribution: {
        model: row.attribution_model,
        clickDays: nonNegative(row.attribution_click_days, "attribution_click_days"),
        viewDays: nonNegative(row.attribution_view_days, "attribution_view_days"),
      },
      spendMinor: decimalMoneyToMinor(row.spend),
      impressions: nonNegative(row.impressions, "impressions"),
      clicks: nonNegative(row.clicks, "clicks"),
      conversions: nonNegative(row.conversions, "conversions", false),
      conversionValueMinor: decimalMoneyToMinor(row.conversion_value),
    });
  }
}
