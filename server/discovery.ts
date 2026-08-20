import { Project, Node, SyntaxKind } from "ts-morph";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  BlockCategory,
  DiscoveredBlock,
  ProjectInventory,
  ScopeInfo,
} from "../shared/types.js";

/**
 * Static discovery of Building Blocks in a target AWS Blocks project.
 *
 * Why AST and not runtime: Scope.getRegisteredBlocks() in @aws-blocks/core is
 * telemetry-filtered — it exposes block type names and counts but not ids or
 * config. The `new <BlockType>(scope, "id", opts)` call sites are the only
 * complete source of truth, and they may be spread across multiple files
 * (factory helpers), so we scan every .ts file under aws-blocks/.
 */

const BLOCK_CATEGORIES: Record<string, BlockCategory> = {
  ApiNamespace: "core",
  RawRoute: "core",
  AuthBasic: "auth",
  AuthCognito: "auth",
  AuthOIDC: "auth",
  KVStore: "data",
  DistributedTable: "data",
  Database: "data",
  DistributedDatabase: "data",
  FileBucket: "storage",
  Realtime: "messaging",
  EmailClient: "messaging",
  AsyncJob: "compute",
  CronJob: "compute",
  Agent: "ai",
  KnowledgeBase: "ai",
  AppSetting: "config",
  Tracer: "observability",
  Logger: "observability",
  Metrics: "observability",
  Dashboard: "observability",
  Hosting: "hosting",
  Pipeline: "hosting",
};

const CONFIG_PREVIEW_MAX = 800;

export function discoverBlocks(projectPath: string): ProjectInventory {
  const backendDir = join(projectPath, "aws-blocks");
  if (!existsSync(backendDir)) {
    throw new Error(`Not an AWS Blocks project: ${backendDir} does not exist`);
  }

  const project = new Project({
    // Parse only; the target project may not even typecheck right now.
    compilerOptions: { allowJs: false, skipLibCheck: true },
    skipAddingFilesFromTsConfig: true,
  });
  // Generated files never declare blocks; scripts/ is scaffolding.
  const sources = project.addSourceFilesAtPaths([
    join(backendDir, "**/*.ts"),
    `!${join(backendDir, "**/*.d.ts")}`,
    `!${join(backendDir, "scripts/**")}`,
    `!${join(backendDir, "index.cdk.ts")}`,
    `!${join(backendDir, "index.handler.ts")}`,
  ]);

  let scope: ScopeInfo | null = null;
  const blocks: DiscoveredBlock[] = [];

  for (const source of sources) {
    const filePath = relative(projectPath, source.getFilePath());
    for (const newExpr of source.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      const typeName = newExpr.getExpression().getText();
      const args = newExpr.getArguments();

      if (typeName === "Scope") {
        const idArg = args[0];
        if (idArg && Node.isStringLiteral(idArg) && !scope) {
          scope = { id: idArg.getLiteralValue(), file: filePath };
        }
        continue;
      }

      if (!(typeName in BLOCK_CATEGORIES)) continue;
      // Blocks are `new X(scope, "id", ...)` — the id is the 2nd argument.
      const idArg = args[1];
      const id = idArg && Node.isStringLiteral(idArg) ? idArg.getLiteralValue() : null;
      if (id === null) continue;

      blocks.push({
        type: typeName,
        id,
        fullId: id, // scope-qualified below, once scope id is known
        category: BLOCK_CATEGORIES[typeName] ?? "other",
        file: filePath,
        line: newExpr.getStartLineNumber(),
        configPreview: extractConfigPreview(args[2]),
        ...(typeName === "ApiNamespace"
          ? { methods: extractApiMethods(args[2]) }
          : {}),
      });
    }
  }

  // Physical resource naming convention: <scopeId>-<blockId> (verified
  // against .bb-data/ directory names in a real project).
  const scopeId = scope?.id;
  for (const block of blocks) {
    block.fullId = scopeId ? `${scopeId}-${block.id}` : block.id;
  }
  blocks.sort((a, b) =>
    a.category === b.category
      ? a.id.localeCompare(b.id)
      : a.category.localeCompare(b.category),
  );

  return {
    projectPath,
    projectName: scopeId ?? projectPath.split("/").filter(Boolean).pop() ?? "unknown",
    scope,
    blocks,
    scannedFiles: sources.length,
  };
}

function extractConfigPreview(arg: Node | undefined): string | null {
  if (!arg || !Node.isObjectLiteralExpression(arg)) return null;
  const text = arg.getText();
  return text.length > CONFIG_PREVIEW_MAX
    ? `${text.slice(0, CONFIG_PREVIEW_MAX)}\n/* … truncated */`
    : text;
}

/**
 * ApiNamespace's 3rd arg is a factory: (context) => ({ methodA() {...}, ... }).
 * Pull the method names off the returned object literal.
 */
function extractApiMethods(arg: Node | undefined): string[] {
  if (!arg) return [];
  const objectLiterals = arg.getDescendantsOfKind(
    SyntaxKind.ObjectLiteralExpression,
  );
  const root = objectLiterals[0];
  if (!root) return [];
  return root
    .getProperties()
    .map((property) => {
      if (Node.isMethodDeclaration(property)) return property.getName();
      if (Node.isPropertyAssignment(property)) return property.getName();
      return null;
    })
    .filter((name): name is string => name !== null);
}
