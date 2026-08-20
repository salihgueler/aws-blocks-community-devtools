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
  /** For ApiNamespace: method names discovered in the factory literal */
  methods?: string[];
}

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
}

export interface CloudEnvStatus {
  /** CloudFormation stack found for this project + profile */
  stackFound: boolean;
  stackName: string;
  profile: string;
  region: string | null;
  accountId: string | null;
  stackStatus: string | null;
  /** Logical block fullId -> physical resource (populated in Phase 3) */
  error: string | null;
}

export interface EnvironmentStatus {
  local: LocalEnvStatus;
  cloud: CloudEnvStatus;
}
