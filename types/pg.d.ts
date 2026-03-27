/** Minimal typings for `pg` when @types/pg is not installed (e.g. CI). */
declare module "pg" {
  export class Pool {
    constructor(config?: { connectionString?: string });
    end(): Promise<void>;
  }
}
