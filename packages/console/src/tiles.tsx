import type { BlockCategory } from "@aws-blocks-devtools/core";

/**
 * Authored identity marks. The category colors ARE the data-syntax palette
 * the console already owns (JSON keys/strings/numbers/booleans) promoted to
 * navigation — the same world, more sure of itself. Drawn SVG, no glyph fonts.
 */

export const CATEGORY_COLORS: Record<BlockCategory, string> = {
  core: "var(--accent)",
  auth: "var(--json-num)",
  data: "var(--json-key)",
  storage: "var(--json-str)",
  messaging: "var(--json-bool)",
  compute: "var(--ok)",
  ai: "var(--warn)",
  config: "var(--json-str)",
  observability: "var(--text-dim)",
  hosting: "var(--json-key)",
  other: "var(--text-dim)",
};

/** Monogram from the type's capitals: DistributedTable -> DT, KVStore -> KV. */
export function monogram(type: string): string {
  return (type.match(/[A-Z]/g) ?? [type[0]?.toUpperCase() ?? "?"])
    .slice(0, 2)
    .join("");
}

export function BlockTile({
  type,
  category,
  size = 26,
}: {
  type: string;
  category: BlockCategory;
  size?: number;
}) {
  const color = CATEGORY_COLORS[category] ?? "var(--text-dim)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      role="img"
      aria-label={type}
      className="block-tile"
    >
      {/* Opaque plate: monogram contrast is measurable, not gradient-dependent */}
      <rect x="1" y="1" width="24" height="24" rx="6" fill="var(--bg)" />
      <rect
        x="1"
        y="1"
        width="24"
        height="24"
        rx="6"
        fill="none"
        stroke={color}
        strokeOpacity="0.65"
      />
      <text
        x="13"
        y="17.5"
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fill={`color-mix(in srgb, ${color} 60%, #ffffff)`}
        style={{ fontFamily: "var(--mono)", letterSpacing: "0.02em" }}
      >
        {monogram(type)}
      </text>
    </svg>
  );
}

/** Three stacked blocks, the console's mark. */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" role="img" aria-label="Blocks Console">
      <rect x="2" y="12" width="8" height="8" rx="2" fill="var(--accent)" />
      <rect x="12" y="12" width="8" height="8" rx="2" fill="var(--json-key)" fillOpacity="0.85" />
      <rect x="7" y="2" width="8" height="8" rx="2" fill="var(--json-str)" fillOpacity="0.85" />
    </svg>
  );
}
