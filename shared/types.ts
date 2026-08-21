/**
 * Shared domain model between the console backend (server/) and UI (src/).
 * A "block" is one Building Block instantiation discovered in the target
 * AWS Blocks project (e.g. `new DistributedTable(scope, "pages", {...})`).
 */

export type BlockCategory =
  | "core"
  | "auth"
  | "data"
  | "storage"
  | "messaging"
  | "compute"
  | "ai"
  | "config"
  | "observability"
  | "hosting"
  | "other";

export interface ApiMethod {
  name: string;
  /** Parameter names as written in source, e.g. ["slug", "input"] */
  params: string[];
}

export interface KeySchema {
  partitionKey: string;
  sortKey?: string;
}

export interface DiscoveredBlock {
  /** Block class name, e.g. "DistributedTable" */
  type: string;
  /** Second constructor arg, e.g. "pages" */
  id: string;
  /** Scope-qualified id used for physical resources, e.g. "some-useful-links-pages" */
  fullId: string;
  category: BlockCategory;
  /** Source location of the `new X(...)` expression */
  file: string;
  line: number;
  /** Best-effort static snapshot of the options literal (may be partial) */
  configPreview: string | null;
  /** For ApiNamespace: methods discovered in the factory literal */
  methods?: ApiMethod[];
  /** For DistributedTable: key fields extracted from the config literal */
  keySchema?: KeySchema;
}

export type WriteMode = "create" | "edit";

export interface ScopeInfo {
  /** First constructor arg of `new Scope(...)`, e.g. "some-useful-links" */
  id: string;
  file: string;
}

export interface ProjectInventory {
  projectPath: string;
  projectName: string;
  scope: ScopeInfo | null;
  blocks: DiscoveredBlock[];
  /** Files scanned, for the UI footer */
  scannedFiles: number;
}

export type EnvMode = "local" | "cloud";

export interface LocalEnvStatus {
  /** Local Blocks dev server responded to a JSON-RPC probe */
  serverUp: boolean;
  serverUrl: string;
  /** .bb-data/ exists (mock state persisted on disk) */
  bbDataPresent: boolean;
  /** Namespaces the running dev server reports exposing */
  namespaces: string[];
  /**
   * true  = server exposes every namespace this project declares
   * false = definitely a different project's dev server on the port
   * null  = cannot tell (no namespaces reported / nothing to compare)
   */
  matchesProject: boolean | null;
}

export interface CloudEnvStatus {
  /** CloudFormation stack found for this project + profile */
  stackFound: boolean;
  stackName: string;
  profile: string;
  region: string | null;
  accountId: string | null;
  stackStatus: string | null;
  error: string | null;
  /** Deployed JSON-RPC endpoint from the stack's ApiUrl output */
  apiUrl: string | null;
}

export interface EnvironmentStatus {
  local: LocalEnvStatus;
  cloud: CloudEnvStatus;
}

/** One record from a block's local store, normalized for tabular display. */
export interface DataRecord {
  key: string;
  value: unknown;
}

export interface BlockDataPage {
  fullId: string;
  /** Which .bb-data file the records came from */
  source: string;
  records: DataRecord[];
  totalRecords: number;
  /** True when values were redacted (auth secrets, session tokens) */
  redacted: boolean;
  error: string | null;
  /** Every store this block can read (a block may shard across several) */
  stores: string[];
  /** Which entry of `stores` produced this page */
  activeStore: string | null;
}

export interface RpcRequest {
  method: string;
  params: unknown[];
}

export interface RpcResponse {
  /** Raw JSON-RPC result or error body, verbatim */
  ok: boolean;
  status: number;
  body: unknown;
  durationMs: number;
}
