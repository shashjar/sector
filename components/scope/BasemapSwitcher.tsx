"use client";

import { BASEMAP_ORDER, BASEMAPS, type BasemapId } from "@/lib/basemaps";

interface BasemapSwitcherProps {
  value: BasemapId;
  onChange: (id: BasemapId) => void;
}

/**
 * Segmented control over the ground layers.
 */
export function BasemapSwitcher({ value, onChange }: BasemapSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Basemap"
      className="pointer-events-auto flex overflow-hidden rounded border border-border-strong bg-surface/95 backdrop-blur-sm"
    >
      {BASEMAP_ORDER.map((id, index) => {
        const basemap = BASEMAPS[id];
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={basemap.hint}
            onClick={() => onChange(id)}
            className={[
              "px-2.5 py-1.5 font-mono text-[0.68rem] tracking-[0.08em] uppercase transition-colors",
              index > 0 ? "border-l border-border" : "",
              selected
                ? "bg-accent-wash text-accent"
                : "text-text-dim hover:bg-surface-2 hover:text-text",
            ].join(" ")}
          >
            {basemap.label}
          </button>
        );
      })}
    </div>
  );
}
