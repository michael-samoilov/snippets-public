"use client";

import { useEffect, useState } from "react";

// TEMPORARY diagnostic overlay for the "today zone too tall on load" jank.
// Off unless the URL has ?debug=vh, so it never shows for normal users.
// Load  <app>/calendar?debug=vh  on the phone, reproduce the bug, screenshot.
// Remove this file + its <VhDebug/> mount once we've read the numbers.
const MARKER = "vhdbg-1"; // bump when redeploying so we can confirm freshness

export function VhDebug() {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("debug") !== "vh") return;

    const probe = (unit: string) => {
      const d = document.createElement("div");
      d.style.cssText = `position:fixed;left:-9999px;top:0;height:100${unit};visibility:hidden;pointer-events:none`;
      document.body.appendChild(d);
      const h = Math.round(d.getBoundingClientRect().height);
      d.remove();
      return h;
    };

    let raf = 0;
    let ticks = 0;
    const read = () => {
      const sc = document.querySelector<HTMLElement>("[data-book-scroller]");
      const zone = document.querySelector<HTMLElement>("[data-today-zone-box]");
      const shellUnit = document.querySelector(".h-svh")
        ? "svh"
        : document.querySelector(".h-dvh")
          ? "dvh"
          : "?";
      const vv = window.visualViewport;
      const out: string[] = [];
      out.push(`build ${MARKER}  ${new Date().toISOString().slice(11, 19)}  t${ticks}`);
      out.push(`SHELL UNIT: ${shellUnit}`); // svh == my fix is live, dvh == stale deploy
      out.push(`innerH ${window.innerHeight}  vv ${vv ? Math.round(vv.height) : "-"}`);
      out.push(`dvh ${probe("dvh")}  svh ${probe("svh")}  lvh ${probe("lvh")}`);
      if (sc) {
        const scBottom = Math.round(sc.getBoundingClientRect().bottom);
        out.push(
          `scroller cH ${sc.clientHeight} sH ${sc.scrollHeight} top ${Math.round(sc.scrollTop)} foot ${sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 4 ? "Y" : "N"}`,
        );
        if (zone) {
          const zb = zone.getBoundingClientRect();
          out.push(
            `zoneH ${Math.round(zb.height)} zBottom ${Math.round(zb.bottom)} overflow ${Math.round(zb.height - sc.clientHeight)}`,
          );
          out.push(`zone below fold: ${zb.bottom > scBottom + 1 ? "YES" : "no"}`);
        }
      }
      setLines(out);
    };

    const loop = () => {
      ticks += 1;
      read();
      if (ticks < 240) raf = requestAnimationFrame(loop); // ~4s of live ticks
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => read();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  if (!lines) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.82)",
        color: "#8dff8d",
        font: "11px/1.35 ui-monospace, SFMono-Regular, monospace",
        padding: "6px 8px",
        pointerEvents: "none",
        whiteSpace: "pre",
        maxWidth: "100vw",
      }}
    >
      {lines.join("\n")}
    </div>
  );
}
