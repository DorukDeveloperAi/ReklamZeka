import type { ScopeReport } from "@/domain/slices/scope-report";

/** Keep every worksheet comfortably below Excel's row ceiling and make export
 * cost explicit even when a repository implementation changes its own cap. */
export const MAX_SCOPE_REPORT_EXPORT_ROWS = 50_001;
export const MAX_SCOPE_REPORT_EXPORT_CELL_UTF16 = 32_767;
export const MAX_SCOPE_REPORT_EXPORT_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_SCOPE_REPORT_EXPORT_PACKAGE_BYTES = 16 * 1024 * 1024;

type Cell = string | number | null;
type Sheet = Readonly<{ name: string; rows: readonly (readonly Cell[])[] }>;
type Entry = Readonly<{ name: string; body: string }>;
const encoder = new TextEncoder();

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** An inline string is never a formula, and the visible apostrophe protects a
 * consumer which later copies the value into CSV or a general spreadsheet. */
export function scopeReportSpreadsheetText(value: string | number | null): string {
  let text = "";
  for (const point of String(value ?? "")) {
    const code = point.codePointAt(0)!;
    // XML 1.0 only permits tab, CR/LF (normalized below), U+0020–D7FF,
    // U+E000–FFFD, and valid supplementary scalar values. Lone surrogate
    // code units and the noncharacters FFFE/FFFF must never reach XML.
    text += code === 9 ? point : code === 10 || code === 13 || code < 32 || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff || code > 0x10ffff ? " " : point;
  }
  const protectedText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  if (protectedText.length > MAX_SCOPE_REPORT_EXPORT_CELL_UTF16) throw new Error("scope report rejected: export_cell_cap");
  return protectedText;
}

function column(index: number): string {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function worksheet(sheet: Sheet): string {
  if (sheet.rows.length > MAX_SCOPE_REPORT_EXPORT_ROWS) throw new Error("scope report rejected: export_cap");
  const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const text = scopeReportSpreadsheetText(value);
    return `<c r="${column(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t${/^\s|\s$/.test(text) ? ' xml:space="preserve"' : ""}>${xml(text)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const point of value) {
    const code = point.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
function escapedXmlUtf8Length(value: string): number {
  let bytes = 0;
  for (const point of value) bytes += point === "&" ? 5 : point === "<" || point === ">" ? 4 : point === '"' || point === "'" ? 6 : utf8Length(point);
  return bytes;
}
function bytes(value: string): number { return utf8Length(value); }
function worksheetBodyBytes(sheet: Sheet): Readonly<{ sourceBytes: number; bodyBytes: number }> {
  let sourceBytes = 0;
  let bodyBytes = bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>') + bytes("</sheetData></worksheet>");
  for (const [rowIndex, row] of sheet.rows.entries()) {
    const rowNumber = rowIndex + 1;
    bodyBytes += bytes(`<row r="${rowNumber}">`) + bytes("</row>");
    for (const [columnIndex, value] of row.entries()) {
      const text = scopeReportSpreadsheetText(value);
      sourceBytes += utf8Length(text);
      bodyBytes += bytes(`<c r="${column(columnIndex)}${rowNumber}" t="inlineStr"><is><t`) + ( /^\s|\s$/.test(text) ? bytes(' xml:space="preserve"') : 0) + 1 + escapedXmlUtf8Length(text) + bytes("</t></is></c>");
    }
  }
  return Object.freeze({ sourceBytes, bodyBytes });
}
function storedZipBytes(entries: readonly Readonly<{ name: string; bodyBytes: number }>[]): number {
  return entries.reduce((total, entry) => total + 30 + bytes(entry.name) + entry.bodyBytes + 46 + bytes(entry.name), 22);
}
function preflightSheets(sheets: readonly Sheet[]): Readonly<{ sourceBytes: number; packageBytes: number }> {
  let sourceBytes = 0;
  const worksheetEntries: { name: string; bodyBytes: number }[] = [];
  for (const sheet of sheets) {
    if (sheet.rows.length > MAX_SCOPE_REPORT_EXPORT_ROWS) throw new Error("scope report rejected: export_cap");
    const counted = worksheetBodyBytes(sheet);
    sourceBytes += counted.sourceBytes;
    if (sourceBytes > MAX_SCOPE_REPORT_EXPORT_SOURCE_BYTES) throw new Error("scope report rejected: export_source_cap");
    worksheetEntries.push({ name: `xl/worksheets/sheet${worksheetEntries.length + 1}.xml`, bodyBytes: counted.bodyBytes });
  }
  const fixed = workbookParts(sheets);
  const packageBytes = storedZipBytes([...fixed.map((entry) => ({ name: entry.name, bodyBytes: bytes(entry.body) })), ...worksheetEntries]);
  if (packageBytes > MAX_SCOPE_REPORT_EXPORT_PACKAGE_BYTES) throw new Error("scope report rejected: export_package_cap");
  return Object.freeze({ sourceBytes, packageBytes });
}
export function scopeReportXlsxPreflight(report: ScopeReport): Readonly<{ sourceBytes: number; packageBytes: number }> {
  return preflightSheets(workbookSheets(report));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value: number): Uint8Array { return Uint8Array.of(value & 255, (value >>> 8) & 255); }
function u32(value: number): Uint8Array { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Small deterministic "stored" ZIP writer. It deliberately has no formulas,
 * shared strings, macros, external links, or timestamps derived from runtime. */
function zip(entries: readonly Readonly<{ name: string; body: string }>[]): Uint8Array {
  const files = entries.map((entry) => ({ name: encoder.encode(entry.name), body: encoder.encode(entry.body) }));
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []; let offset = 0;
  for (const file of files) {
    const crc = crc32(file.body);
    const local = concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x0021), u32(crc), u32(file.body.length), u32(file.body.length), u16(file.name.length), u16(0), file.name, file.body]);
    locals.push(local);
    centrals.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x0021), u32(crc), u32(file.body.length), u32(file.body.length), u16(file.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), file.name]));
    offset += local.length;
  }
  const central = concat(centrals);
  return concat([...locals, central, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
}

function workbookSheets(report: ScopeReport): readonly Sheet[] {
  const scope: Sheet = { name: "Scope", rows: [
    ["field", "value"], ["version", report.version], ["slice_ref", report.scope.sliceRef], ["revision_ref", report.scope.revisionRef], ["revision_number", String(report.scope.revisionNumber)], ["definition_hash", report.scope.definitionHash],
    ["market_dimension_ref", report.scope.market.dimensionRef], ["market_value_ref", report.scope.market.valueRef], ["market_key", report.scope.market.key], ["granularity", report.appliedFilters.granularity], ["start_date", report.appliedFilters.startDate], ["end_date", report.appliedFilters.endDate], ["entity_level", report.appliedFilters.entityLevel], ["metric_key", report.appliedFilters.metricKey], ["action_type", report.appliedFilters.actionType], ["sort", report.appliedFilters.sort], ["direction", report.appliedFilters.direction],
    ["included_count", String(report.counts.included)], ["excluded_count", String(report.counts.excluded)], ["missing_market_count", String(report.counts.missingMarket)], ["ambiguous_market_count", String(report.counts.ambiguousMarket)], ["meta_write", "disabled"], ["action_authority", "none"],
  ] };
  const memberships: Sheet = { name: "Membership", rows: [["entity_ref", "entity_level", "membership", "reason", "market_evidence_refs", "matched_dimension_refs", "matched_dimension_evidence_refs"], ...report.rows.map((row) => [row.entityRef, row.entityLevel, row.membership, row.reason, row.marketEvidenceRefs.join(" "), row.matchedDimensionRefs.join(" "), row.matchedDimensionEvidenceRefs.join(" ")]) ] };
  const raw: Sheet = { name: "Raw Metrics", rows: [["entity_ref", "entity_level", "bucket", "date", "attribution", "metric_key", "action_type", "value_decimal", "value_minor", "currency", "availability"], ...report.rawMetrics.map((row) => [row.entityRef, row.entityLevel, row.bucket, row.date, row.attribution, row.metricKey, row.actionType, row.valueDecimal, row.valueMinor, row.currency, row.availability]) ] };
  const coverage: Sheet = { name: "Coverage", rows: [["entity_ref", "entity_level", "action_type", "expected_days", "observed_days", "missing_days", "source_state", "reason_codes"], ...report.coverage.map((row) => [row.entityRef, row.entityLevel, row.actionType, row.expectedDays.join(" "), row.observedDays.join(" "), row.missingDays.join(" "), row.sourceState, row.reasonCodes.join(" ")]) ] };
  const pivot: Sheet = { name: "Pivot", rows: [["entity_ref", "entity_level", "bucket", "metric_count", "available_metric_count", "spend_per_action_numerator_minor", "spend_per_action_denominator_action", "drill_entity_ref", "drill_bucket"], ...report.pivot.map((row) => [row.entityRef, row.entityLevel, row.bucket, String(row.subtotal.metricCount), String(row.subtotal.availableMetricCount), row.ratios.spendPerAction?.numeratorMinor ?? null, row.ratios.spendPerAction?.denominatorAction ?? null, row.drill.entityRef, row.drill.bucket]) ] };
  return [scope, memberships, raw, coverage, pivot];
}

function workbookParts(sheets: readonly Sheet[]): readonly Entry[] {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>ReklamZeka</dc:creator><cp:lastModifiedBy>ReklamZeka</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ReklamZeka</Application><Company>ReklamZeka</Company></Properties>`;
  return [{ name: "[Content_Types].xml", body: contentTypes }, { name: "_rels/.rels", body: relationships }, { name: "docProps/core.xml", body: core }, { name: "docProps/app.xml", body: app }, { name: "xl/workbook.xml", body: workbook }, { name: "xl/_rels/workbook.xml.rels", body: workbookRelationships }];
}

export function scopeReportXlsx(report: ScopeReport): Uint8Array {
  const sheets = workbookSheets(report);
  preflightSheets(sheets); // No worksheet XML string is joined before this exact package-size check.
  const entries = [...workbookParts(sheets), ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, body: worksheet(sheet) }))];
  const output = zip(entries);
  if (output.length > MAX_SCOPE_REPORT_EXPORT_PACKAGE_BYTES) throw new Error("scope report rejected: export_package_cap");
  return output;
}
