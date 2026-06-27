import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
} from "node:fs";
import { dirname } from "node:path";

const BACK_CHUNK = 64 * 1024;

/**
 * Iterate JSON-parsed rows from the END of a JSONL file, newest first, reading
 * only as much of the file as needed. `onRow` returns false to stop early, so
 * memory and IO are bounded by the result — not the (possibly huge) file size.
 */
function forEachRowBackward<T>(path: string, onRow: (row: T) => boolean): void {
  if (!existsSync(path)) return;
  const fd = openSync(path, "r");
  try {
    let pos = fstatSync(fd).size;
    let carry = ""; // partial leading line whose start lies in an earlier chunk
    const buf = Buffer.allocUnsafe(BACK_CHUNK);
    while (pos > 0) {
      const len = Math.min(BACK_CHUNK, pos);
      pos -= len;
      readSync(fd, buf, 0, len, pos);
      const text = buf.toString("utf8", 0, len) + carry;
      const lines = text.split("\n");
      carry = lines.shift() ?? "";
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!;
        if (!line.trim()) continue;
        try {
          if (!onRow(JSON.parse(line) as T)) return;
        } catch {
          // skip malformed line
        }
      }
    }
    if (carry.trim()) {
      try {
        onRow(JSON.parse(carry) as T);
      } catch {
        // skip
      }
    }
  } finally {
    closeSync(fd);
  }
}

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
  const rows: T[] = [];
  forEachRowBackward<T>(path, (row) => {
    if (!filter || filter(row)) rows.push(row);
    return rows.length < limit;
  });
  rows.reverse(); // newest-first → chronological
  return rows;
}

export function readJsonlRangeSync<T extends { ts_ms?: number }>(
  path: string,
  limit: number,
  fromMs?: number,
  toMs?: number,
): T[] {
  // Files are append-ordered by ts_ms, so reading backward we can stop as soon
  // as we pass below fromMs. Keeps the newest `limit` rows within the range.
  const rows: T[] = [];
  forEachRowBackward<T>(path, (row) => {
    const ts = row.ts_ms ?? 0;
    if (toMs !== undefined && ts > toMs) return true; // newer than range, keep scanning back
    if (fromMs !== undefined && ts < fromMs) return false; // older than range → stop
    rows.push(row);
    return rows.length < limit;
  });
  rows.reverse();
  return rows;
}

export function readLastJsonlRow<T>(path: string): T | null {
  const rows = readJsonlTailSync<T>(path, 1);
  return rows[0] ?? null;
}
