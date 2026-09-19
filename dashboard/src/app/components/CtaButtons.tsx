"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { IconArrowRight } from "./Icons";

/**
 * Auth-aware primary CTA. Avoids skeleton flashes: it renders the honest
 * default ("Start free — no card") immediately, then swaps to a Dashboard
 * link only if a session actually resolves. Server-safe; rendered in the
 * hero and the closing panel.
 */
export default function CtaButtons({ size = "md" }: { size?: "md" | "lg" }) {
  const [isUser, setIsUser] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!cancelled) setIsUser(Boolean(data?.user));
      })
      .catch(() => {
        if (!cancelled) setIsUser(false);
      })
      .finally(() => {
        if (!cancelled) setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cls =
    size === "lg" ? "py-4 px-9 text-base" : "py-3.5 px-8 text-base";

  if (resolved && isUser) {
    return (
      <Link href="/dashboard" className={`cm-btn-primary ${cls}`}>
        Go to Dashboard
        <IconArrowRight className="w-[17px] h-[17px]" />
      </Link>
    );
  }

  return (
    <Link href="/login" className={`cm-btn-primary ${cls}`}>
      Start free — no card
      <IconArrowRight className="w-[17px] h-[17px]" />
    </Link>
  );
}