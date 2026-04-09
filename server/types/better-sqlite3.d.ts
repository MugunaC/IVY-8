declare module 'better-sqlite3' {
  type SqlValue = string | number | bigint | Buffer | null;

  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(...params: any[]): RunResult;
    get<T = unknown>(...params: any[]): T | undefined;
    all<T = unknown>(...params: any[]): T[];
  }

  export default class Database {
    constructor(filename?: string, options?: unknown);
    pragma(source: string, options?: unknown): unknown;
    exec(sql: string): void;
    prepare(sql: string): Statement;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
  }

  export namespace Database {
    export type Database = import('better-sqlite3').default;
  }
}
