"use client";

/* Dev lab for the sheet's paper texture — two rooms in one route.
 *
 *   /lab/texture           the TUNER: a live shader over real paper with
 *                          every dial exposed, so a recipe can be shaped by
 *                          hand and read off the page.
 *   /lab/texture?bake      the BAKE view: the same shader full-bleed at
 *                          opacity 1, nothing else on the page, so it can be
 *                          screenshot to a static bitmap (public/textures).
 *                          ?theme=dark bakes the Lamplight variant. Any dial
 *                          can be pinned in the URL (?fiber=0.7&seed=3…), so
 *                          the tuner's "bake ▸" link bakes exactly what you
 *                          tuned without editing this file first.
 *
 * The texture is a STATIC (speed=0) WebGL shader — a heavy GPU layer that iOS
 * must re-rasterize at the pinch scale (the zoom crash). Baking it once to a
 * bitmap means the app ships a plain background image and never loads WebGL at
 * all. When a tuned recipe is adopted, copy it into SHIPPED below (the single
 * source of truth for what this route bakes) and re-shoot both themes. */

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";

const PaperTexture = dynamic(
  () => import("@/vendor/paper-shaders/react/shaders/paper-texture").then((m) => m.PaperTexture),
  { ssr: false },
);

/* ── the shipped recipe: the single source of truth for the bake ───────
   The shape dials (grain, fibre, crumple…) are shared across both themes;
   only the two colours differ. Change these, re-shoot, and the app's
   public/textures follow. */
const SHIPPED = {
  light: { colorBack: "#f7f1e3", colorFront: "#ddd0b2" },
  dark: { colorBack: "#1d1812", colorFront: "#322a1d" },
  params: {
    contrast: 0.16,
    roughness: 0.18,
    fiber: 0.55,
    fiberSize: 0.1,
    crumples: 0.1,
    crumpleSize: 0.3,
    folds: 0,
    foldCount: 1,
    drops: 0.06,
    fade: 0,
    seed: 7,
    scale: 1,
  },
};

type Params = typeof SHIPPED.params;
type ParamKey = keyof Params;

/* dial ranges — bounds drawn from the vendored presets, widened where the
   shipped recipe already sits past a preset (fibre) */
const FIELDS: {
  key: ParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  note?: string;
}[] = [
  { key: "contrast", label: "contrast", min: 0, max: 1, step: 0.01, note: "how hard the light rakes the grain" },
  { key: "roughness", label: "roughness", min: 0, max: 1, step: 0.01, note: "broad tooth of the sheet" },
  { key: "fiber", label: "fibre", min: 0, max: 1.2, step: 0.01, note: "the hairline threads in the pulp" },
  { key: "fiberSize", label: "fibre size", min: 0.04, max: 0.5, step: 0.01 },
  { key: "crumples", label: "crumple", min: 0, max: 1, step: 0.01, note: "soft rumples across the page" },
  { key: "crumpleSize", label: "crumple size", min: 0.05, max: 1, step: 0.01 },
  { key: "folds", label: "folds", min: 0, max: 1, step: 0.01, note: "hard creases (0 = a flat sheet)" },
  { key: "foldCount", label: "fold count", min: 1, max: 15, step: 1 },
  { key: "drops", label: "drops", min: 0, max: 0.5, step: 0.01, note: "faint spatter" },
  { key: "fade", label: "fade", min: 0, max: 1, step: 0.01, note: "washes the grain out in patches" },
  { key: "seed", label: "seed", min: 0, max: 20, step: 0.1, note: "reshuffles the whole field" },
  { key: "scale", label: "scale", min: 0.3, max: 3, step: 0.05, note: "grain size relative to the sheet" },
];

/* the production compositing (globals.css .sheet-grain): the bake is laid
   over real paper at this opacity behind a top-anchored fade mask — so the
   tuner can show how a recipe actually READS in the app, not just its raw bake */
const GRAIN_OPACITY = { light: 0.65, dark: 0.5 };
const GRAIN_MASK = "linear-gradient(to bottom, black 55%, transparent 98%)";

function fmt(v: number, step: number) {
  return step >= 1 ? String(Math.round(v)) : v.toFixed(2);
}

/* ── the bake view — full-bleed, nothing else, screenshot to a bitmap ── */
function paramsFromSearch(sp: { get(key: string): string | null }, base: Params): Params {
  const out = { ...base };
  for (const f of FIELDS) {
    const raw = sp.get(f.key);
    if (raw != null && raw !== "" && !Number.isNaN(+raw)) out[f.key] = +raw;
  }
  return out;
}

function Bake() {
  const sp = useSearchParams();
  const dark = sp.get("theme") === "dark";
  const seed = dark ? SHIPPED.dark : SHIPPED.light;
  const colorBack = sp.get("colorBack") ?? seed.colorBack;
  const colorFront = sp.get("colorFront") ?? seed.colorFront;
  const params = paramsFromSearch(sp, SHIPPED.params);
  return (
    // z-50 lifts the bake clear of the app-shell chrome (wordmark, dock) that
    // the root layout draws behind every route — otherwise it bleeds into the
    // baked bitmap, as the old bake view did
    <div data-texture-bake style={{ position: "fixed", inset: 0, zIndex: 50, background: colorBack }}>
      <PaperTexture
        colorBack={colorBack}
        colorFront={colorFront}
        {...params}
        speed={0}
        style={{ width: "100%", height: "100%", opacity: 1 }}
      />
    </div>
  );
}

/* ── the tuner ──────────────────────────────────────────────────────── */

/* one dial: label + live value + range, matching the wax-wash lab's desk */
function Dial({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[0.85rem]">
      <span className="voice-data w-24 shrink-0 lowercase text-ink-soft">
        {label} {fmt(value, step)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full min-w-0"
      />
    </label>
  );
}

function Tuner() {
  const { resolvedTheme, setTheme } = useTheme();
  const sp = useSearchParams();
  const [mode, setMode] = useState<"light" | "dark">("light");
  // follow the app theme once it resolves (until the user flips it here)
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned && resolvedTheme) setMode(resolvedTheme === "dark" ? "dark" : "light");
  }, [resolvedTheme, pinned]);

  // a recipe pinned in the URL (?fiber=0.8&crumples=0.3…) opens the tuner
  // pre-tuned, so a candidate is deep-linkable
  const [params, setParams] = useState<Params>(() => paramsFromSearch(sp, SHIPPED.params));
  const [light, setLight] = useState({ ...SHIPPED.light });
  const [dark, setDark] = useState({ ...SHIPPED.dark });
  // raw bake (opacity 1) vs the in-app composite over real paper
  const [raw, setRaw] = useState(false);

  const colors = mode === "dark" ? dark : light;
  const setColors = mode === "dark" ? setDark : setLight;

  const set = (key: ParamKey, v: number) => setParams((p) => ({ ...p, [key]: v }));

  const flipMode = () => {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    setPinned(true);
    setTheme(next);
  };

  const reset = () => {
    setParams({ ...SHIPPED.params });
    setLight({ ...SHIPPED.light });
    setDark({ ...SHIPPED.dark });
  };

  /* the copy-paste recipe — a <PaperTexture> prop block, ready to drop into
     SHIPPED or the bake view */
  const recipe = useMemo(() => {
    const lines = [
      `colorBack="${colors.colorBack}"`,
      `colorFront="${colors.colorFront}"`,
      ...FIELDS.map((f) => `${String(f.key)}={${fmt(params[f.key], f.step)}}`),
      `speed={0}`,
    ];
    return lines.join("\n");
  }, [colors, params]);

  /* a bake URL that pins the current recipe — self-serve re-baking */
  const bakeHref = useMemo(() => {
    const q = new URLSearchParams();
    q.set("bake", "1");
    if (mode === "dark") q.set("theme", "dark");
    q.set("colorBack", colors.colorBack);
    q.set("colorFront", colors.colorFront);
    for (const f of FIELDS) q.set(String(f.key), fmt(params[f.key], f.step));
    return `?${q.toString()}`;
  }, [colors, params, mode]);

  const composite = raw ? 1 : GRAIN_OPACITY[mode];

  return (
    <main className="fixed inset-0 z-50 overflow-auto bg-[var(--desk)] p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="voice-display text-[1.4rem] text-ink">paper texture</h1>
        <button
          type="button"
          onClick={flipMode}
          className="voice-label pressable rounded-full border border-rule px-3 py-1 text-[0.72rem] text-ink-soft"
        >
          {mode === "dark" ? "lamplight" : "paper"}
        </button>
        <button
          type="button"
          onClick={() => setRaw((v) => !v)}
          className="voice-label pressable rounded-full border border-rule px-3 py-1 text-[0.72rem] text-ink-soft"
        >
          {raw ? "raw bake" : "in app"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="voice-label pressable rounded-full border border-rule px-3 py-1 text-[0.72rem] text-ink-soft"
        >
          reset
        </button>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* the sheet — a live preview over real paper, sample ink on top so
            legibility can be judged the way the words actually sit on it */}
        <div className="lg:sticky lg:top-8">
          <div
            className="relative h-[560px] w-[min(88vw,420px)] overflow-hidden rounded-[6px] shadow-[var(--sheet-shadow)]"
            style={{ background: "var(--paper)" }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0"
              style={{
                height: "100%",
                opacity: composite,
                WebkitMaskImage: raw ? undefined : GRAIN_MASK,
                maskImage: raw ? undefined : GRAIN_MASK,
              }}
            >
              <PaperTexture
                colorBack={colors.colorBack}
                colorFront={colors.colorFront}
                {...params}
                speed={0}
                style={{ width: "100%", height: "100%", opacity: 1 }}
              />
            </div>
            <div className="relative flex h-full flex-col gap-4 p-7">
              <p className="voice-label text-[0.7rem] text-ink-faint">Friday · July 4</p>
              <h2 className="voice-display text-[1.7rem] leading-tight text-ink">
                The grain is grace, not load-bearing.
              </h2>
              <p className="voice-prose text-[0.95rem] leading-[1.5] text-ink">
                A sheet of paper on the desk, under lamplight. The fibres pull
                strongest where the light pools at the top and fade out down the
                page. Drag a dial and watch the tooth change beneath the words —
                the ink should always win.
              </p>
              <p className="voice-prose text-[0.95rem] leading-[1.5] text-ink-soft">
                Lower the grain until the letters sit clean; raise the fibre for
                more hand-made pulp; a touch of crumple reads as a page that has
                been carried.
              </p>
              <span className="voice-data mt-auto text-[0.62rem] lowercase text-ink-faint">
                {raw ? "raw bake · opacity 1" : `in-app composite · opacity ${composite}`}
              </span>
            </div>
          </div>
        </div>

        {/* the dials + the recipe to carry away */}
        <div className="flex w-full max-w-[420px] flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
            <label className="col-span-1 flex items-center gap-2 text-[0.85rem]">
              <span className="voice-data w-14 shrink-0 lowercase text-ink-soft">back</span>
              <input
                type="color"
                value={colors.colorBack}
                onChange={(e) => setColors((c) => ({ ...c, colorBack: e.target.value }))}
                className="h-7 w-full min-w-0 rounded"
              />
            </label>
            <label className="col-span-1 flex items-center gap-2 text-[0.85rem]">
              <span className="voice-data w-14 shrink-0 lowercase text-ink-soft">front</span>
              <input
                type="color"
                value={colors.colorFront}
                onChange={(e) => setColors((c) => ({ ...c, colorFront: e.target.value }))}
                className="h-7 w-full min-w-0 rounded"
              />
            </label>
          </div>

          {FIELDS.map((f) => (
            <div key={String(f.key)}>
              <Dial
                label={f.label}
                value={params[f.key]}
                min={f.min}
                max={f.max}
                step={f.step}
                onChange={(v) => set(f.key, v)}
              />
              {f.note && (
                <p className="voice-data mt-0.5 pl-24 text-[0.58rem] lowercase text-ink-faint">
                  {f.note}
                </p>
              )}
            </div>
          ))}

          {/* the recipe: what production gets */}
          <div className="mt-3 rounded-[6px] border border-rule-faint p-3" style={{ background: "var(--paper)" }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="voice-label text-[0.68rem] text-ink-soft">
                {mode === "dark" ? "lamplight" : "paper"} recipe
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={bakeHref}
                  className="voice-label pressable rounded-full border border-rule px-2.5 py-0.5 text-[0.64rem] text-ink-soft"
                >
                  bake ▸
                </a>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(recipe)}
                  className="voice-label pressable rounded-full border border-rule px-2.5 py-0.5 text-[0.64rem] text-ink-soft"
                >
                  copy
                </button>
              </div>
            </div>
            <pre className="voice-data overflow-x-auto whitespace-pre text-[0.64rem] lowercase text-ink">
              {recipe}
            </pre>
          </div>
          <p className="voice-data text-[0.58rem] lowercase text-ink-faint">
            the shape dials are shared across both themes; only the two colours
            differ. tune one, flip to the other, adjust colours, then bake each.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function TextureLab() {
  return (
    <Suspense fallback={null}>
      <Gate />
    </Suspense>
  );
}

function Gate() {
  const sp = useSearchParams();
  if (sp.has("bake")) return <Bake />;
  return <Tuner />;
}
