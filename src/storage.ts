import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SpendEvent, Storage, UsageSummary } from "./types.js";

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
function monthKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7);
}

interface ScopeRecord {
  total: number;
  requests: number;
  byDay: Record<string, number>;
  byMonth: Record<string, number>;
}

function emptyRecord(): ScopeRecord {
  return { total: 0, requests: 0, byDay: {}, byMonth: {} };
}

export class MemoryStorage implements Storage {
  private scopes = new Map<string, ScopeRecord>();

  record(event: SpendEvent): void {
    const rec = this.scopes.get(event.scope) ?? emptyRecord();
    const d = dayKey(event.timestamp);
    const m = monthKey(event.timestamp);
    rec.total += event.costUsd;
    rec.requests += 1;
    rec.byDay[d] = (rec.byDay[d] ?? 0) + event.costUsd;
    rec.byMonth[m] = (rec.byMonth[m] ?? 0) + event.costUsd;
    this.scopes.set(event.scope, rec);
  }

  summary(scope: string): UsageSummary {
    const rec = this.scopes.get(scope) ?? emptyRecord();
    const now = Date.now();
    return {
      scope,
      day: rec.byDay[dayKey(now)] ?? 0,
      month: rec.byMonth[monthKey(now)] ?? 0,
      total: rec.total,
      requests: rec.requests,
    };
  }

  reset(scope?: string): void {
    if (scope === undefined) this.scopes.clear();
    else this.scopes.delete(scope);
  }
}

/**
 * Persists usage to a JSON file. Use this for CLI tools, scripts,
 * or single-process servers. For multi-process or distributed setups,
 * implement the `Storage` interface against Redis/Postgres.
 */
export class FileStorage implements Storage {
  private cache: Record<string, ScopeRecord> = {};
  private loaded = false;

  constructor(private readonly path: string) {}

  private load(): void {
    if (this.loaded) return;
    if (existsSync(this.path)) {
      try {
        this.cache = JSON.parse(readFileSync(this.path, "utf8"));
      } catch {
        this.cache = {};
      }
    }
    this.loaded = true;
  }

  private flush(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.cache, null, 2), "utf8");
  }

  record(event: SpendEvent): void {
    this.load();
    const rec = this.cache[event.scope] ?? emptyRecord();
    const d = dayKey(event.timestamp);
    const m = monthKey(event.timestamp);
    rec.total += event.costUsd;
    rec.requests += 1;
    rec.byDay[d] = (rec.byDay[d] ?? 0) + event.costUsd;
    rec.byMonth[m] = (rec.byMonth[m] ?? 0) + event.costUsd;
    this.cache[event.scope] = rec;
    this.flush();
  }

  summary(scope: string): UsageSummary {
    this.load();
    const rec = this.cache[scope] ?? emptyRecord();
    const now = Date.now();
    return {
      scope,
      day: rec.byDay[dayKey(now)] ?? 0,
      month: rec.byMonth[monthKey(now)] ?? 0,
      total: rec.total,
      requests: rec.requests,
    };
  }

  reset(scope?: string): void {
    this.load();
    if (scope === undefined) this.cache = {};
    else delete this.cache[scope];
    this.flush();
  }
}
