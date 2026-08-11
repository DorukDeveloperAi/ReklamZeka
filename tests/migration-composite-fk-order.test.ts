import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type JournalEntry = { idx: number; tag: string };
type OrderedStatement = { migration: string; position: number; sql: string };

const root = process.cwd();
const identifier = '(?:"[^"]+"|[a-z_][a-z0-9_$]*)';

function normalizeIdentifier(value: string) {
  return value.trim().replace(/^"|"$/g, "").toLowerCase();
}

function normalizeColumns(value: string) {
  return value.split(",").map((column) => normalizeIdentifier(column));
}

function keyFor(table: string, columns: string[]) {
  return `${normalizeIdentifier(table)}(${columns.join(",")})`;
}

function journalStatements(): OrderedStatement[] {
  const journal = JSON.parse(readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };

  return journal.entries
    .sort((left, right) => left.idx - right.idx)
    .flatMap((entry) => {
      const path = join(root, "drizzle", `${entry.tag}.sql`);
      expect(existsSync(path), `journaled migration is missing: ${entry.tag}`).toBe(true);
      return readFileSync(path, "utf8")
        .split(/--> statement-breakpoint\s*/)
        .map((sql, statementIndex) => ({
          migration: entry.tag,
          position: entry.idx * 100_000 + statementIndex,
          sql,
        }));
    });
}

function referencedCompositeKeys(statement: OrderedStatement) {
  const matches = statement.sql.matchAll(new RegExp(
    `FOREIGN\\s+KEY\\s*\\(([^)]+)\\)\\s*REFERENCES\\s+(?:${identifier}\\s*\\.\\s*)?(${identifier})\\s*\\(([^)]+)\\)`,
    "gi",
  ));

  return [...matches]
    .flatMap((match) => {
      const table = match[2];
      const columns = match[3];
      return table && columns ? [{ table: normalizeIdentifier(table), columns: normalizeColumns(columns) }] : [];
    })
    .filter((reference) => reference.columns.length > 1);
}

function targetKeysCreatedBy(statement: OrderedStatement) {
  const keys: string[] = [];
  const createTable = statement.sql.match(new RegExp(`CREATE\\s+TABLE\\s+(?:${identifier}\\s*\\.\\s*)?(${identifier})`, "i"));
  const alteredTable = statement.sql.match(new RegExp(`ALTER\\s+TABLE\\s+(?:${identifier}\\s*\\.\\s*)?(${identifier})`, "i"));
  const table = createTable?.[1] ?? alteredTable?.[1];

  if (table) {
    for (const match of statement.sql.matchAll(/(?:PRIMARY\s+KEY|\bUNIQUE)\s*\(([^)]+)\)/gi)) {
      const columns = match[1] ? normalizeColumns(match[1]) : [];
      if (columns.length > 1) keys.push(keyFor(table, columns));
    }
  }

  for (const match of statement.sql.matchAll(new RegExp(
    `CREATE\\s+UNIQUE\\s+INDEX\\s+${identifier}\\s+ON\\s+(?:${identifier}\\s*\\.\\s*)?(${identifier})(?:\\s+USING\\s+\\w+)?\\s*\\(([^)]+)\\)`,
    "gi",
  ))) {
    const table = match[1];
    const columns = match[2] ? normalizeColumns(match[2]) : [];
    if (table && columns.length > 1) keys.push(keyFor(table, columns));
  }

  return keys;
}

describe("Drizzle composite foreign-key ordering", () => {
  it("creates every referenced ordered composite PK or UNIQUE key before its foreign key in journal order", () => {
    const keys = new Set<string>();
    const inversions: string[] = [];

    for (const statement of journalStatements()) {
      for (const reference of referencedCompositeKeys(statement)) {
        const target = keyFor(reference.table, reference.columns);
        if (!keys.has(target)) {
          inversions.push(`${statement.migration}: ${target}`);
        }
      }
      for (const key of targetKeysCreatedBy(statement)) keys.add(key);
    }

    expect(inversions, "composite FK target keys must precede their FK statements").toEqual([]);
  });
});
