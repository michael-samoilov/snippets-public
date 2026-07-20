/**
 * Types for the link-preview (OG image) variant lab — /lab/og.
 *
 * A variant is a 1200×630 composition described as data: a themed stage plus a
 * list of absolutely-positioned blocks. The lab route renders variants at
 * blocking fidelity from the app's real materials (tokens, Fraunces, paper
 * textures, the live WaxStamp); scripts/bake-og.mjs screenshots each one.
 * Kept as JSON (og-variants.json) so the bake script — plain .mjs, no TS —
 * reads the same file the page renders. Mirrors the icon-seal.json /
 * seal-spec.ts arrangement.
 *
 * Coordinates are in 1200×630 canvas px. Keep anything critical inside the
 * central 630×630 (iMessage square-crops on the lock screen) and inside the
 * vertical middle 16:9 band (X crops top/bottom).
 */

export type OgTheme = "light" | "dark";

/** Typeset text. `text` may be a literal or a token: $name, $tagline, $url,
 *  $dateWeekday (e.g. "Sunday"), $dateFull (e.g. "July 20"). */
export interface OgTextBlock {
  kind: "text";
  text: string;
  /** the app's type voices (globals.css) — display = Fraunces letterpress,
   *  label = small-caps serif, prose = entry text, mono = tiny data voice. */
  voice: "display" | "label" | "prose" | "mono";
  sizePx: number;
  x: number;
  y: number;
  /** wrap width; omit for a single unwrapped line */
  w?: number;
  align?: "left" | "center" | "right";
  color?: "ink" | "ink-soft" | "ink-faint" | "wax" | "gilt";
  italic?: boolean;
  /** unitless line-height (default 1.1 display / 1.5 prose) */
  lineHeight?: number;
  /** letter-spacing in em, overriding the voice default */
  trackingEm?: number;
}

/** The live 3-D wax seal (WaxStamp), centred at (cx, cy). May overflow the
 *  stage for macro crops. */
export interface OgSealBlock {
  kind: "seal";
  cx: number;
  cy: number;
  sizePx: number;
  /** real tilted-camera relight (module — until built, the lab falls back to
   *  a CSS tilt of the head-on render and labels it as a stand-in) */
  tiltDeg?: number;
  /** cheap CSS perspective tilt of the head-on render (comparison variant) */
  cssTilt?: number;
  /** wordmark blues (per-theme) or the app icon's deep navy */
  tint?: "wordmark" | "icon";
  /** in-plane rotation, degrees */
  rotateDeg?: number;
  glyph?: string;
}

/** A sheet of paper on the desk — the app's real texture + shadow tokens. */
export interface OgSheetBlock {
  kind: "sheet";
  x: number;
  y: number;
  w: number;
  h: number;
  rotateDeg?: number;
  /** paper grain texture (default true) */
  grain?: boolean;
  /** the warm layered sheet shadow (default true) */
  shadow?: boolean;
}

/** The masthead wordmark, restated statically: seal + "nippets". */
export interface OgWordmarkBlock {
  kind: "wordmark";
  cx: number;
  cy: number;
  fontPx: number;
}

/** A captured app view ("altitude"). Frameless by default it renders with a
 *  sheet-like frame (border + shadow) as if a screenshot laid on the desk; set
 *  `bleed` to drop the frame and show the raw app UI (fill the box, no border/
 *  shadow) — the "just app UI, not a photo of a phone" look. */
export interface OgPlateBlock {
  kind: "plate";
  view: "today" | "year" | "calendar" | "schedule" | "entry";
  x: number;
  y: number;
  w: number;
  h: number;
  rotateDeg?: number;
  /** frameless full-bleed app UI (no border/shadow/radius) */
  bleed?: boolean;
  /** use the portrait bleed capture (<view>-bleed.png) instead of the tall
   *  phone plate — matches a portrait canvas without cropping */
  portrait?: boolean;
  /** object-position for the cover crop (default "top center") */
  focus?: string;
}

/** Lamplight — a warm radial light overlay; the app's depth cue. */
export interface OgLightBlock {
  kind: "light";
  cx: number;
  cy: number;
  radius: number;
  /** 0..1 (default 0.5) */
  strength?: number;
}

/** Generic blocking box for anything not yet buildable — renders as a dashed
 *  outline with its label, so a direction can be judged before its module exists. */
export interface OgBoxBlock {
  kind: "box";
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OgBlock =
  | OgTextBlock
  | OgSealBlock
  | OgSheetBlock
  | OgWordmarkBlock
  | OgPlateBlock
  | OgLightBlock
  | OgBoxBlock;

export interface OgVariant {
  key: string;
  theme: OgTheme;
  /** one-sentence concept, shown in the lab index and the review gallery */
  concept: string;
  /** the design lens this direction came from (hero / editorial / app-truth / …) */
  lens: string;
  /** modules this direction needs at full fidelity (absent = pure lab CSS) */
  needs?: ("tilt" | "plate")[];
  /** canvas size in px (default 1200×630 landscape). Portrait variants set a
   *  taller box — iMessage/Slack render it tall; note FB/X center-crop to
   *  ~1.91:1, so keep the essential content within the vertical middle band. */
  size?: { w: number; h: number };
  blocks: OgBlock[];
}

import raw from "./og-variants.json";
export const OG_VARIANTS = raw as OgVariant[];
