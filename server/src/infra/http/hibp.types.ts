/**
 * Vazamento como a HIBP devolve em /breaches, /breach/{name} e /breachedaccount
 * (sem truncateResponse). Com truncateResponse=true só vem o Name.
 */
export interface HibpBreach {
  Name: string;
  Title: string;
  Domain?: string;
  BreachDate: string;
  AddedDate?: string;
  ModifiedDate?: string;
  PwnCount?: number;
  Description?: string;
  DataClasses: string[];
  IsVerified: boolean;
  IsFabricated?: boolean;
  IsSensitive?: boolean;
  IsRetired?: boolean;
  IsSpamList?: boolean;
  IsMalware?: boolean;
  IsStealerLog?: boolean;
  [key: string]: unknown;
}

/** Resposta de GET /subscription/status */
export interface HibpSubscriptionStatus {
  SubscriptionName: string;
  Description?: string;
  SubscribedUntil?: string;
  Rpm: number;
  DomainSearchMaxBreachedAccounts?: number;
  IncludesStealerLogs?: boolean;
  [key: string]: unknown;
}

export interface BreachedAccountOptions {
  /** true: só os nomes ({ Name }), resposta menor; false: vazamento completo */
  truncate?: boolean;
}

/** Contrato comum do cliente real e do mock */
export interface HibpClientLike {
  /** Fluxo manual: modo degradado devolve [] quando a HIBP está indisponível ou sem chave */
  checkAccount(email: string): Promise<any[]>;
  /** Monitoramento: nunca devolve [] por erro; lança HibpError tipado */
  getBreachedAccountStrict(email: string, options?: BreachedAccountOptions): Promise<any[]>;
  getSubscriptionStatus(): Promise<HibpSubscriptionStatus>;
  shutdown?(): Promise<void>;
}

/** Endpoints públicos (sem chave, fora da cota) */
export interface HibpCatalogClientLike {
  getAllBreaches(): Promise<HibpBreach[]>;
  getBreach(name: string): Promise<HibpBreach | null>;
  getLatestBreach(): Promise<HibpBreach | null>;
}
