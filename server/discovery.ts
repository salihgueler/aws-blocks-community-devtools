import { Project, Node, SyntaxKind } from "ts-morph";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  ApiMethod,
  BlockCategory,
  DiscoveredBlock,
  KeySchema,
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
        ...(typeName === "DistributedTable"
          ? { keySchema: extractKeySchema(args[2]) }
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
 * DistributedTable config: `{ key: { partitionKey: "pk", sortKey: "sk" } }`.
 * Read the string literals off the nested `key` object.
 */
function extractKeySchema(arg: Node | undefined): KeySchema | undefined {
  if (!arg || !Node.isObjectLiteralExpression(arg)) return undefined;
  const keyProperty = arg.getProperty("key");
  if (!keyProperty || !Node.isPropertyAssignment(keyProperty)) return undefined;
  const keyLiteral = keyProperty.getInitializer();
  if (!keyLiteral || !Node.isObjectLiteralExpression(keyLiteral)) return undefined;

  const readString = (name: string): string | undefined => {
    const property = keyLiteral.getProperty(name);
    if (!property || !Node.isPropertyAssignment(property)) return undefined;
    const initializer = property.getInitializer();
    return initializer && Node.isStringLiteral(initializer)
      ? initializer.getLiteralValue()
      : undefined;
  };

  const partitionKey = readString("partitionKey");
  if (!partitionKey) return undefined;
  const sortKey = readString("sortKey");
  return sortKey ? { partitionKey, sortKey } : { partitionKey };
}

/**
 * ApiNamespace's 3rd arg is a factory: (context) => ({ methodA(a, b) {...} }).
 * Pull method names and parameter names off the returned object literal.
 */
function extractApiMethods(arg: Node | undefined): ApiMethod[] {
  if (!arg) return [];
  const objectLiterals = arg.getDescendantsOfKind(
    SyntaxKind.ObjectLiteralExpression,
  );
  const root = objectLiterals[0];
  if (!root) return [];
  const methods: ApiMethod[] = [];
  for (const property of root.getProperties()) {
    if (Node.isMethodDeclaration(property)) {
      methods.push({
        name: property.getName(),
        params: property.getParameters().map((parameter) => parameter.getName()),
      });
    } else if (Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      const params =
        initializer &&
        (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
          ? initializer.getParameters().map((parameter) => parameter.getName())
          : [];
      methods.push({ name: property.getName(), params });
    }
  }
  return methods;
}
