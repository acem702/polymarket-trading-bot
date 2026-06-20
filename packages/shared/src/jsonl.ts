import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export class JsonlWriter {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  static open(path: string): JsonlWriter {
    return new JsonlWriter(path);
  }

  write(record: unknown): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }
}

export function readJsonlTailSync<T>(
  path: string,
  limit: number,
  filter?: (row: T) => boolean,
): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  const rows: T[] = [];
  for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
    try {
      const row = JSON.parse(lines[i]!) as T;
      if (!filter || filter(row)) rows.unshift(row);
    } catch {
      // skip malformed lines
    }
  }
  return rows;
}

export function readJsonlRangeSync<T extends { ts_ms?: number }>(
  path: string,
  limit: number,
  fromMs?: number,
  toMs?: number,
): T[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n").filter((l) => l.trim());
  const rows: T[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as T;
      const ts = row.ts_ms ?? 0;
      if (fromMs !== undefined && ts < fromMs) continue;
      if (toMs !== undefined && ts > toMs) break;
      rows.push(row);
    } catch {
      // skip
    }
  }
  if (rows.length > limit) return rows.slice(rows.length - limit);
  return rows;
}

export function readLastJsonlRow<T>(path: string): T | null {
  const rows = readJsonlTailSync<T>(path, 1);
  return rows[0] ?? null;
}
