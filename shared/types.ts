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
  /** Scope-qualified id used for physical resources, e.g. "myapp-pages" */
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
  /** First constructor arg of `new Scope(...)`, e.g. "myapp" */
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
  /** Stack names that were looked for, so the UI can explain a miss */
  candidates: string[];
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

/** One deployed CloudFormation resource, with somewhere to click through to. */
export interface ResourceRow {
  logicalId: string;
  physicalId: string;
  type: string;
  typeLabel: string;
  status: string | null;
  consoleUrl: string;
  /** false when the link points at the stack rather than the resource itself */
  directLink: boolean;
}

export interface ResourceGroup {
  /** Block fullId, or null when the group is not a block */
  blockFullId: string | null;
  /**
   * "block"   — caused by one `new SomeBlock(scope, ...)` declaration
   * "feature" — a CDK-side construct that is a feature, not a block (Hosting)
   * "service" — leftover framework resources bucketed by AWS service
   */
  kind: "block" | "feature" | "service";
  label: string;
  /** Short explanation of what the group is, for non-block groups. */
  note: string | null;
  resources: ResourceRow[];
}

export interface ResourceInventory {
  stackName: string;
  region: string;
  accountId: string | null;
  total: number;
  groups: ResourceGroup[];
  stackUrl: string;
  error: string | null;
}
