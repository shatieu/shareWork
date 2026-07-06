import { randomUUID } from 'node:crypto';
import type { PgBuilder, PgResult, PgRow, PostgrestLikeClient } from '../src/supabase-store.js';

/**
 * Faithful-enough in-memory PostgREST mock for the SupabaseSeaChestStore mapping: chainable
 * select/insert/update + eq/is/order/maybeSingle/single, unique-constraint emulation with
 * PostgreSQL error code 23505, uuid/default fills matching the migration DDL. Also records
 * every executed query (`log`) so tests can assert user-id scoping on each operation.
 *
 * Emulates PLAIN table access (as a service-role/owner client would see it) -- RLS behavior
 * is exercised separately by supabase/local-check against real Postgres.
 */

interface TableSpec {
  uniques: string[][];
  defaults: Record<string, () => unknown>;
}

const TABLES: Record<string, TableSpec> = {
  locker_items: {
    uniques: [['user_id', 'name'], ['id']],
    defaults: { id: () => randomUUID(), team_id: () => null, published: () => false },
  },
  locker_versions: {
    uniques: [['item_id', 'version'], ['id']],
    defaults: { id: () => randomUUID() },
  },
  machine_profiles: {
    uniques: [['user_id', 'name'], ['id']],
    defaults: { id: () => randomUUID() },
  },
  marketplace_tokens: {
    uniques: [['token_hash'], ['id']],
    defaults: { id: () => randomUUID(), revoked_at: () => null, label: () => '' },
  },
};

export interface QueryLogEntry {
  table: string;
  op: 'select' | 'insert' | 'update';
  filters: { column: string; value: unknown }[];
}

export class PostgrestMock implements PostgrestLikeClient {
  readonly rows = new Map<string, PgRow[]>();
  readonly log: QueryLogEntry[] = [];
  /** Test hook: runs before each execution (e.g. to simulate concurrent writes). */
  beforeExecute: ((entry: QueryLogEntry) => void) | null = null;

  table(name: string): PgRow[] {
    let t = this.rows.get(name);
    if (!t) {
      t = [];
      this.rows.set(name, t);
    }
    return t;
  }

  from(table: string): PgBuilder {
    return new MockBuilder(this, table) as unknown as PgBuilder;
  }
}

class MockBuilder implements PromiseLike<PgResult<PgRow[]>> {
  private op: 'select' | 'insert' | 'update' = 'select';
  private values: PgRow | PgRow[] | null = null;
  private filters: { column: string; value: unknown }[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private wantReturn = false;

  constructor(
    private readonly mock: PostgrestMock,
    private readonly tableName: string,
  ) {}

  select(_columns?: string): PgBuilder {
    if (this.op === 'select') this.wantReturn = true;
    else this.wantReturn = true;
    return this.asBuilder();
  }

  insert(values: PgRow | PgRow[]): PgBuilder {
    this.op = 'insert';
    this.values = values;
    return this.asBuilder();
  }

  update(values: PgRow): PgBuilder {
    this.op = 'update';
    this.values = values;
    return this.asBuilder();
  }

  eq(column: string, value: unknown): PgBuilder {
    this.filters.push({ column, value });
    return this.asBuilder();
  }

  is(column: string, value: null): PgBuilder {
    this.filters.push({ column, value });
    return this.asBuilder();
  }

  order(column: string, opts?: { ascending?: boolean }): PgBuilder {
    this.orderBy = { column, ascending: opts?.ascending ?? true };
    return this.asBuilder();
  }

  maybeSingle(): PromiseLike<PgResult<PgRow>> {
    return this.execute().then(({ data, error }) => {
      if (error) return { data: null, error };
      if (!data || data.length === 0) return { data: null, error: null };
      if (data.length > 1) {
        return { data: null, error: { message: 'more than one row returned', code: 'PGRST116' } };
      }
      return { data: data[0], error: null };
    });
  }

  single(): PromiseLike<PgResult<PgRow>> {
    return this.execute().then(({ data, error }) => {
      if (error) return { data: null, error };
      if (!data || data.length !== 1) {
        return { data: null, error: { message: 'expected exactly one row', code: 'PGRST116' } };
      }
      return { data: data[0], error: null };
    });
  }

  then<T1 = PgResult<PgRow[]>, T2 = never>(
    onfulfilled?: ((value: PgResult<PgRow[]>) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private asBuilder(): PgBuilder {
    return this as unknown as PgBuilder;
  }

  private matches(row: PgRow): boolean {
    return this.filters.every((f) => row[f.column] === f.value);
  }

  private async execute(): Promise<PgResult<PgRow[]>> {
    const entry: QueryLogEntry = { table: this.tableName, op: this.op, filters: this.filters };
    this.mock.beforeExecute?.(entry);
    this.mock.log.push(entry);
    const spec = TABLES[this.tableName];
    if (!spec) return { data: null, error: { message: `unknown table ${this.tableName}` } };
    const rows = this.mock.table(this.tableName);

    if (this.op === 'insert') {
      const toInsert = Array.isArray(this.values) ? this.values : [this.values!];
      const inserted: PgRow[] = [];
      for (const raw of toInsert) {
        const row: PgRow = { ...raw };
        for (const [col, make] of Object.entries(spec.defaults)) {
          if (row[col] === undefined) row[col] = make();
        }
        for (const unique of spec.uniques) {
          const clash = rows.some((r) => unique.every((c) => r[c] === row[c]));
          if (clash) {
            return {
              data: null,
              error: {
                message: `duplicate key value violates unique constraint (${unique.join(',')})`,
                code: '23505',
              },
            };
          }
        }
        rows.push(row);
        inserted.push(structuredClone(row));
      }
      return { data: inserted, error: null };
    }

    if (this.op === 'update') {
      const updated: PgRow[] = [];
      for (const row of rows) {
        if (!this.matches(row)) continue;
        Object.assign(row, this.values as PgRow);
        updated.push(structuredClone(row));
      }
      return { data: updated, error: null };
    }

    let result = rows.filter((r) => this.matches(r)).map((r) => structuredClone(r));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result = result.sort((a, b) => {
        const av = a[column] as string | number;
        const bv = b[column] as string | number;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return ascending ? cmp : -cmp;
      });
    }
    return { data: result, error: null };
  }
}
