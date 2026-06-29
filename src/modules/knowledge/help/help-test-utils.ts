import { FindOperator } from "typeorm";

/**
 * Minimal in-memory stand-in for a TypeORM repository, supporting the subset of
 * the API used by the Help Center services: find / findOne / create / save /
 * merge / delete, with equality, `In(...)` and `ILike(...)` operators and
 * array-of-where (OR) matching. Keeps the unit tests free of a live database.
 */
export class FakeRepository<T extends { id?: string }> {
  rows: T[] = [];
  private seq = 0;

  constructor(initial: T[] = []) {
    initial.forEach((row) => this.save(row));
  }

  private matchOne(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, condition]) => {
      const value = (row as Record<string, unknown>)[key];
      if (condition instanceof FindOperator) {
        const operand = condition.value as unknown;
        if (condition.type === "in") {
          return Array.isArray(operand) && operand.includes(value);
        }
        if (condition.type === "ilike") {
          const needle = String(operand).replace(/%/g, "").toLowerCase();
          return String(value ?? "").toLowerCase().includes(needle);
        }
        return false;
      }
      return value === condition;
    });
  }

  private matchWhere(
    row: T,
    where: Record<string, unknown> | Record<string, unknown>[],
  ): boolean {
    if (Array.isArray(where)) {
      return where.some((clause) => this.matchOne(row, clause));
    }
    return this.matchWhere0(row, where);
  }

  private matchWhere0(row: T, where: Record<string, unknown>): boolean {
    return this.matchOne(row, where);
  }

  private applyOrder(rows: T[], order?: Record<string, "ASC" | "DESC">): T[] {
    if (!order) return rows;
    const keys = Object.entries(order);
    return [...rows].sort((a, b) => {
      for (const [key, dir] of keys) {
        const av = this.sortable((a as Record<string, unknown>)[key]);
        const bv = this.sortable((b as Record<string, unknown>)[key]);
        if (av < bv) return dir === "ASC" ? -1 : 1;
        if (av > bv) return dir === "ASC" ? 1 : -1;
      }
      return 0;
    });
  }

  private sortable(value: unknown): number | string {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") return value;
    return String(value ?? "");
  }

  find(options?: {
    where?: Record<string, unknown> | Record<string, unknown>[];
    order?: Record<string, "ASC" | "DESC">;
  }): Promise<T[]> {
    const where = options?.where;
    const filtered = where
      ? this.rows.filter((row) => this.matchWhere(row, where))
      : [...this.rows];
    return Promise.resolve(this.applyOrder(filtered, options?.order));
  }

  findOne(options: {
    where: Record<string, unknown> | Record<string, unknown>[];
  }): Promise<T | null> {
    const found = this.rows.find((row) => this.matchWhere(row, options.where));
    return Promise.resolve(found ?? null);
  }

  create(input: Partial<T>): T {
    return { ...(input as T) };
  }

  save(input: T): Promise<T>;
  save(input: T[]): Promise<T[]>;
  save(input: T | T[]): Promise<T | T[]> {
    if (Array.isArray(input)) {
      return Promise.resolve(input.map((row) => this.saveOne(row)));
    }
    return Promise.resolve(this.saveOne(input));
  }

  private saveOne(row: T): T {
    if (!row.id) {
      row.id = `id-${++this.seq}`;
    }
    const index = this.rows.findIndex((r) => r.id === row.id);
    if (index >= 0) {
      this.rows[index] = row;
    } else {
      this.rows.push(row);
    }
    return row;
  }

  merge(target: T, partial: Partial<T>): T {
    Object.assign(target as object, partial);
    return target;
  }

  delete(criteria: Record<string, unknown>): Promise<{ affected: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !this.matchOne(row, criteria));
    return Promise.resolve({ affected: before - this.rows.length });
  }
}
