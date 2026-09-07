import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep, extname } from "node:path";

/**
 * Serves the built frontend from dist/.
 *
 * In development Vite serves the UI and proxies the API here. A published
 * package has no Vite, so without this the API would answer and the page
 * would be blank. Same-process serving also means one port and no proxy.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export interface StaticResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

/**
 * @param distRoot absolute path to the built assets
 * @returns the file response, or null when the request is not servable
 *          (missing build, or a path that escapes the root)
 */
export function serveStatic(distRoot: string, pathname: string): StaticResponse | null {
  if (!existsSync(join(distRoot, "index.html"))) return null;

  const requested = pathname === "/" ? "/index.html" : pathname;
  const target = resolve(distRoot, `.${requested}`);
  // Never serve outside the build directory, whatever the URL claims.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) return null;

  if (existsSync(target) && statSync(target).isFile()) {
    return file(target);
  }
  // Unknown path with no extension: hand back the SPA shell so client-side
  // routes work; a missing asset stays a 404 rather than silently returning
  // HTML that the browser would try to parse as JS or CSS.
  if (extname(requested) === "") {
    return file(join(distRoot, "index.html"));
  }
  return { status: 404, headers: { "Content-Type": "text/plain" }, body: "not found" };
}

function file(path: string): StaticResponse {
  const type = CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
  // Hashed asset filenames are safe to cache hard; index.html must not be.
  const immutable = /-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/.test(path);
  return {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
    body: readFileSync(path),
  };
}
