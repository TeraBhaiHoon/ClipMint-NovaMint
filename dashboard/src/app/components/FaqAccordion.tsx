"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { springSmooth } from "./SectionReveal";

/**
 * Identity §9.9 / §6 — AnimatePresence height:auto accordion with
 * spring.smooth. First item open by default; forms of honesty: every
 * answer states a real format, limit or policy.
 */

export type FaqItem = { q: string; a: string };

export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className="flex flex-col gap-3.5 w-full">
      {items.map((item, i) => {
        const open = openIdx === i;
        return (
          <div
            key={item.q}
            className={`rounded-2xl border bg-ink-850 transition-colors duration-200 ${
              open ? "border-mint-500/30" : "border-white/5 hover:border-mint-500/25"
            }`}
          >
            <button
              className="w-full flex justify-between items-center gap-4 text-left py-5 px-6 font-semibold text-[16px] text-ink-50 cursor-pointer bg-transparent border-none font-[family-name:inherit]"
              aria-expanded={open}
              onClick={() => setOpenIdx(open ? null : i)}
            >
              <span>{item.q}</span>
              <ChevronDown
                size={18}
                className={`shrink-0 transition-transform duration-300 ${
                  open ? "rotate-180 text-mint-400" : "text-ink-500"
                }`}
              />
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="answer"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springSmooth}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-5 text-[15px] leading-[1.6] text-ink-300">
                    {item.a}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
