"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A sideways-scrolling row of chips without a scrollbar: edges fade where there's
 * more, arrow buttons (mouse users) scroll by a page, the wheel scrolls sideways,
 * and the selected chip (`.on`) is kept in view. Touch still swipes.
 */
export default function ChipStrip({ label, selected, children }: { label: string; selected?: string | null; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    // Vertical wheels scroll the strip sideways (the canvas zoom only listens on the canvas).
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY, behavior: "auto" });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    ref.current?.querySelector(".on")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [selected]);

  const page = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: "smooth" });
  };

  return (
    <div className={`chip-strip${more.left ? " more-left" : ""}${more.right ? " more-right" : ""}`}>
      <button className="strip-arrow left" onClick={() => page(-1)} aria-label="Scroll left" tabIndex={-1} hidden={!more.left}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <nav className="obs-list" aria-label={label} ref={ref} onScroll={measure}>
        {children}
      </nav>
      <button className="strip-arrow right" onClick={() => page(1)} aria-label="Scroll right" tabIndex={-1} hidden={!more.right}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}
