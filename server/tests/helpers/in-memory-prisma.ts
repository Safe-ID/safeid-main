/**
 * Prisma em memória para testes de fluxo sem PostgreSQL. Cobre o subconjunto que o
 * monitoramento usa: filtros (igualdade, null, not, gt/gte/lt/lte, in, OR/AND, caminho em JSON),
 * chaves únicas (lança P2002), orderBy, take, select, @updatedAt e `user: { connect }`.
 */

type Row = Record<string, any>;

interface ModelConfig {
  idField?: string;
  autoIncrement?: boolean;
  unique?: string[][];
  defaults?: () => Row;
  updatedAt?: string[];
}

const OPERATOR_KEYS = new Set(['not', 'gt', 'gte', 'lt', 'lte', 'in']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);
}

function toComparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function equals(a: unknown, b: unknown): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  return toComparable(a) === toComparable(b);
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  // Filtro de campo JSON do Prisma: { path: ['isVerified'], equals: false }
  if (isPlainObject(condition) && Array.isArray((condition as Row).path)) {
    const nested = ((condition as Row).path as string[]).reduce<unknown>(
      (current, key) => (isPlainObject(current) ? (current as Row)[key] : undefined),
      value,
    );
    return equals(nested, (condition as Row).equals);
  }
  if (isPlainObject(condition) && Object.keys(condition).some(key => OPERATOR_KEYS.has(key))) {
    return Object.entries(condition).every(([op, operand]) => {
      const left = toComparable(value) as any;
      const right = toComparable(operand) as any;
      switch (op) {
        case 'not':
          return operand === null ? value !== null && value !== undefined : !equals(value, operand);
        case 'gt':
          return value !== null && value !== undefined && left > right;
        case 'gte':
          return value !== null && value !== undefined && left >= right;
        case 'lt':
          return value !== null && value !== undefined && left < right;
        case 'lte':
          return value !== null && value !== undefined && left <= right;
        case 'in':
          return (operand as unknown[]).some(item => equals(value, item));
        default:
          return false;
      }
    });
  }
  return equals(value, condition);
}

export function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some(sub => matchesWhere(row, sub));
    if (key === 'AND') return (condition as Row[]).every(sub => matchesWhere(row, sub));
    // Chave composta: { userId_dedupeKey: { userId, dedupeKey } }
    if (isPlainObject(condition) && !Object.keys(condition).some(k => OPERATOR_KEYS.has(k)) && !(key in row)) {
      return matchesWhere(row, condition);
    }
    return matchesCondition(row[key], condition);
  });
}

function project(row: Row, select?: Row): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]]));
}

function sortRows(rows: Row[], orderBy?: Row | Row[]): Row[] {
  if (!orderBy) return rows;
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const [field, direction] = Object.entries(order)[0];
      const left = toComparable(a[field]) as any;
      const right = toComparable(b[field]) as any;
      if (left === right) continue;
      const result = left < right ? -1 : 1;
      return direction === 'desc' ? -result : result;
    }
    return 0;
  });
}

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

export class InMemoryModel {
  readonly rows: Row[] = [];
  private nextId = 1;

  constructor(private readonly config: ModelConfig = {}) {}

  private get idField(): string {
    return this.config.idField ?? 'id';
  }

  private touch(row: Row): void {
    for (const field of this.config.updatedAt ?? []) {
      row[field] = new Date();
    }
  }

  private normalize(data: Row): Row {
    const result = { ...data };
    if (isPlainObject(result.user) && isPlainObject((result.user as Row).connect)) {
      result.userId = ((result.user as Row).connect as Row).id;
      delete result.user;
    }
    return result;
  }

  private assertUnique(candidate: Row, ignore?: Row): void {
    const keys = [[this.idField], ...(this.config.unique ?? [])];
    for (const fields of keys) {
      if (fields.some(field => candidate[field] === undefined || candidate[field] === null)) continue;
      const clash = this.rows.find(row => row !== ignore && fields.every(field => equals(row[field], candidate[field])));
      if (clash) throw uniqueViolation();
    }
  }

  findMany = async (args: Row = {}): Promise<Row[]> => {
    let rows = this.rows.filter(row => matchesWhere(row, args.where));
    rows = sortRows(rows, args.orderBy);
    if (typeof args.take === 'number') rows = rows.slice(0, args.take);
    return rows.map(row => project(row, args.select));
  };

  findFirst = async (args: Row = {}): Promise<Row | null> => (await this.findMany({ ...args, take: 1 }))[0] ?? null;

  findUnique = async (args: Row): Promise<Row | null> => {
    const row = this.rows.find(item => matchesWhere(item, args.where));
    return row ? project(row, args.select) : null;
  };

  findUniqueOrThrow = async (args: Row): Promise<Row> => {
    const row = await this.findUnique(args);
    if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
    return row;
  };

  count = async (args: Row = {}): Promise<number> => this.rows.filter(row => matchesWhere(row, args.where)).length;

  create = async (args: Row): Promise<Row> => {
    const data = this.normalize(args.data);
    const row: Row = { ...(this.config.defaults?.() ?? {}), ...data };
    if (this.config.autoIncrement !== false && row[this.idField] === undefined) {
      row[this.idField] = this.nextId++;
    }
    this.touch(row);
    this.assertUnique(row);
    this.rows.push(row);
    return { ...row };
  };

  update = async (args: Row): Promise<Row> => {
    const row = this.rows.find(item => matchesWhere(item, args.where));
    if (!row) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' });
    const next = { ...row, ...this.normalize(args.data) };
    this.assertUnique(next, row);
    Object.assign(row, next);
    this.touch(row);
    return { ...row };
  };

  updateMany = async (args: Row): Promise<{ count: number }> => {
    const rows = this.rows.filter(row => matchesWhere(row, args.where));
    rows.forEach(row => {
      Object.assign(row, this.normalize(args.data));
      this.touch(row);
    });
    return { count: rows.length };
  };

  upsert = async (args: Row): Promise<Row> => {
    const row = this.rows.find(item => matchesWhere(item, args.where));
    return row ? this.update({ where: args.where, data: args.update }) : this.create({ data: args.create });
  };

  delete = async (args: Row): Promise<Row> => {
    const index = this.rows.findIndex(row => matchesWhere(row, args.where));
    if (index < 0) throw Object.assign(new Error('Record to delete not found'), { code: 'P2025' });
    return this.rows.splice(index, 1)[0];
  };

  deleteMany = async (args: Row = {}): Promise<{ count: number }> => {
    const keep = this.rows.filter(row => !matchesWhere(row, args.where));
    const count = this.rows.length - keep.length;
    this.rows.splice(0, this.rows.length, ...keep);
    return { count };
  };

  aggregate = async (args: Row): Promise<Row> => {
    const result: Row = {};
    for (const field of Object.keys(args._max ?? {})) {
      const values = this.rows.map(row => row[field]).filter(value => value !== null && value !== undefined);
      result[field] = values.length ? values.reduce((max, value) => (toComparable(value)! > toComparable(max)! ? value : max)) : null;
    }
    return { _max: result };
  };
}

export function createInMemoryPrisma() {
  const prisma: Row = {
    user: new InMemoryModel({
      unique: [['email'], ['googleId']],
      updatedAt: ['updatedAt'],
      defaults: () => ({
        passwordHash: null,
        googleId: null,
        scanSnapshot: null,
        scanSnapshotUpdatedAt: null,
        termsAcceptedAt: null,
        emailVerifiedAt: null,
        monitoringEnabled: true,
        monitoringConsentAt: null,
        lastMonitoredAt: null,
        breachBaselineAt: null,
        createdAt: new Date(),
      }),
    }),
    scanHistory: new InMemoryModel({
      unique: [['jobId']],
      updatedAt: ['updatedAt'],
      defaults: () => ({ source: 'MANUAL', isVerified: false, createdAt: new Date() }),
    }),
    userBreach: new InMemoryModel({
      unique: [['userId', 'breachName']],
      defaults: () => ({ firstSeenAt: new Date(), notifiedAt: null }),
    }),
    breachCatalog: new InMemoryModel({ idField: 'name', autoIncrement: false, updatedAt: ['syncedAt'] }),
    catalogSyncState: new InMemoryModel({ autoIncrement: false }),
    notification: new InMemoryModel({
      unique: [['userId', 'dedupeKey']],
      defaults: () => ({ readAt: null, emailStatus: 'PENDING', emailSentAt: null, createdAt: new Date() }),
    }),
    emailVerificationToken: new InMemoryModel({
      unique: [['tokenHash']],
      defaults: () => ({ usedAt: null, createdAt: new Date() }),
    }),
  };

  prisma.$transaction = async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: Row) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[]);

  return prisma as Row & {
    user: InMemoryModel;
    scanHistory: InMemoryModel;
    userBreach: InMemoryModel;
    breachCatalog: InMemoryModel;
    catalogSyncState: InMemoryModel;
    notification: InMemoryModel;
    emailVerificationToken: InMemoryModel;
  };
}

/** Fila BullMQ em memória: guarda os jobs e respeita jobId e deduplication como o BullMQ */
export class FakeQueue {
  readonly jobs: Array<{ id: string; name: string; data: any; opts: any }> = [];
  readonly history: Array<{ id: string; name: string; data: any; opts: any }> = [];
  private nextId = 1;

  constructor(readonly name: string) {}

  add = async (name: string, data: any, opts: any = {}) => {
    const dedupeId = opts.deduplication?.id;
    if (dedupeId && this.jobs.some(job => job.opts.deduplication?.id === dedupeId)) {
      return null;
    }
    if (opts.jobId && [...this.jobs, ...this.history].some(job => job.id === opts.jobId)) {
      return null;
    }
    const job = { id: opts.jobId ?? String(this.nextId++), name, data, opts };
    this.jobs.push(job);
    this.history.push(job);
    return job;
  };

  /** Próximo job respeitando a prioridade (sem priority = maior prioridade) */
  take() {
    if (this.jobs.length === 0) return undefined;
    const sorted = [...this.jobs].sort((a, b) => (a.opts.priority ?? 0) - (b.opts.priority ?? 0));
    const next = sorted[0];
    this.jobs.splice(this.jobs.indexOf(next), 1);
    return next;
  }

  getJobCounts = async (...types: string[]) => Object.fromEntries(types.map(type => [type, type === 'waiting' ? this.jobs.length : 0]));

  readonly schedulers: Array<{ key: string; name: string; pattern?: string; tz?: string; next?: number }> = [];

  upsertJobScheduler = async (key: string, repeat: { pattern?: string; tz?: string }, template: { name: string }) => {
    const existing = this.schedulers.find(item => item.key === key);
    const next = { key, name: template.name, pattern: repeat.pattern, tz: repeat.tz, next: Date.UTC(2026, 9, 15, 13, 5) };
    if (existing) Object.assign(existing, next);
    else this.schedulers.push(next);
    return {};
  };

  getJobSchedulers = async () => this.schedulers.map(item => ({ ...item }));
}

export function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    incr: async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    },
    expire: async () => 1,
    publish: async () => 1,
    // SCAN de uma página só, com MATCH no formato prefixo*
    scan: async (_cursor: string, _match: string, pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      return ['0', Array.from(store.keys()).filter(key => key.startsWith(prefix))];
    },
  };
}
