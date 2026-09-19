"use client";

import { useState } from "react";
import { IconChevronDown } from "./Icons";

/**
 * Accordion with a buttery height animation via the CSS grid-rows trick
 * (0fr → 1fr, expo ease) — no JS measuring, no motion library. First item
 * open by default. Every answer states a real format, limit or policy.
 */

export type FaqItem = { q: string; a: string };

export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className="flex flex-col gap-3.5 w-full">
      {items.map((item, i) => {
        const open = openIdx === i;
        const panelId = `faq-panel-${i}`;
        const buttonId = `faq-button-${i}`;
        return (
          <div key={item.q} className={`faq-wrap ${open ? "open" : ""}`}>
            <button
              id={buttonId}
              type="button"
              className="faq-q"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenIdx(open ? null : i)}
            >
              <span>{item.q}</span>
              <IconChevronDown className="faq-chev w-[18px] h-[18px]" />
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className="faq-a-grid"
            >
              <div className="faq-a-inner">
                <p className="faq-a">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}