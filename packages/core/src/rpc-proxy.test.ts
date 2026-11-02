import { afterEach, describe, expect, it, vi } from "vitest";
import { namespaceRequestUrl, proxyRpc } from "./rpc-proxy.js";

describe("namespaceRequestUrl", () => {
  it("appends the namespace to the base URL", () => {
    expect(namespaceRequestUrl("http://localhost:3000/aws-blocks/api", "api")).toBe(
      "http://localhost:3000/aws-blocks/api/api",
    );
  });

  it("trims trailing slashes first", () => {
    expect(namespaceRequestUrl("https://d1.cloudfront.net/aws-blocks/api//", "shop")).toBe(
      "https://d1.cloudfront.net/aws-blocks/api/shop",
    );
  });
});

describe("proxyRpc", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the per-namespace path", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ result: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await proxyRpc({ method: "shop.list", params: [] }, "http://x/aws-blocks/api");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://x/aws-blocks/api/shop");
  });

  it("falls back to the bare endpoint when the gateway has no namespace route", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/shop")
        ? new Response("Missing Authentication Token", { status: 403 })
        : new Response(JSON.stringify({ result: 2 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await proxyRpc({ method: "shop.list", params: [] }, "http://x/aws-blocks/api");

    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ result: 2 });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://x/aws-blocks/api");
  });
});
