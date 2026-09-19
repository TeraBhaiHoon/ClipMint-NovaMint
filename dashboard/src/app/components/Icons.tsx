import type { SVGProps } from "react";

/**
 * ClipMint custom icon set — hand-drawn inline SVGs, 24×24 viewBox.
 * Stroke icons use a consistent 1.75 hairline at "round" caps/joins so
 * they read as one family next to the mint-on-ink palette. No third-party
 * icon library. All icons default to `aria-hidden`; add an explicit
 * `aria-label` + `role="img"` at the call site when the icon carries
 * meaning on its own.
 */

type IconProps = SVGProps<SVGSVGElement>;

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconPlay(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M7.5 5.6v12.8c0 .7.8 1.1 1.4.7l10-6.4a.85.85 0 0 0 0-1.4l-10-6.4a.85.85 0 0 0-1.4.7Z" />
    </svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <rect x="6.5" y="5" width="3.4" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="14.1" y="5" width="3.4" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M4.5 12h15" />
      <path d="M13.5 6l6 6-6 6" />
    </svg>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M19.5 12h-15" />
      <path d="M10.5 6l-6 6 6 6" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h10" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M12 15V4.2" />
      <path d="M7.8 8.4L12 4.2l4.2 4.2" />
      <path d="M4 15.5v3.2A1.3 1.3 0 0 0 5.3 20h13.4a1.3 1.3 0 0 0 1.3-1.3v-3.2" />
    </svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M12 4.2V15" />
      <path d="M16.2 10.8L12 15l-4.2-4.2" />
      <path d="M4 15.5v3.2A1.3 1.3 0 0 0 5.3 20h13.4a1.3 1.3 0 0 0 1.3-1.3v-3.2" />
    </svg>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M12 3.5c.6 3.6 2.2 5.7 5.7 6.3-3.5.6-5.1 2.7-5.7 6.3-.6-3.6-2.2-5.7-5.7-6.3 3.5-.6 5.1-2.7 5.7-6.3Z" />
      <path d="M18.6 15.4c.35 1.9 1.1 3 3 3.4-1.9.4-2.65 1.5-3 3.4-.35-1.9-1.1-3-3-3.4 1.9-.4 2.65-1.5 3-3.4Z" />
    </svg>
  );
}

export function IconCut(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <circle cx="6" cy="6.5" r="2.3" />
      <circle cx="6" cy="17.5" r="2.3" />
      <path d="M7.9 7.9l12 10" />
      <path d="M7.9 16.1l12-10" />
    </svg>
  );
}

export function IconCaptions(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M6.5 12.5c.4-.9 1.2-1.4 2.1-1.4 1.1 0 2 .8 2 1.9v.5c0 1.1-.9 1.9-2 1.9-.9 0-1.7-.5-2.1-1.4" />
      <path d="M13.7 12.5c.4-.9 1.2-1.4 2.1-1.4 1.1 0 2 .8 2 1.9v.5c0 1.1-.9 1.9-2 1.9-.9 0-1.7-.5-2.1-1.4" />
    </svg>
  );
}

export function IconWave(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M4 13.5v-3" />
      <path d="M8 11v-4.5" />
      <path d="M8 15V11c.8 0 1.5.6 1.5 1.4V13c0 .8-.7 1.4-1.5 1.4v.5" />
      <path d="M12 9V5.5" />
      <path d="M12 14.5V9c.8 0 1.5.6 1.5 1.4V13c0 .8-.7 1.4-1.5 1.4v.2" />
      <path d="M16 10.5V11" />
      <path d="M16 13v2.5" />
      <path d="M20 12.5v-1" />
    </svg>
  );
}

export function IconMaximize(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M8.5 4H5a1 1 0 0 0-1 1v3.5" />
      <path d="M15.5 4H19a1 1 0 0 1 1 1v3.5" />
      <path d="M8.5 20H5a1 1 0 0 1-1-1v-3.5" />
      <path d="M15.5 20H19a1 1 0 0 0 1-1v-3.5" />
    </svg>
  );
}

export function IconKey(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <circle cx="8" cy="15.5" r="3.6" />
      <path d="M10.5 13L20 4.5" />
      <path d="M15.5 8.5l2.5 2.5" />
    </svg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M9.5 14.5l5-5" />
      <path d="M11.5 5.5l1.6-1.6a4.4 4.4 0 0 1 6.2 6.2l-2.3 2.3" />
      <path d="M12.5 18.5l-1.6 1.6a4.4 4.4 0 0 1-6.2-6.2l2.3-2.3" />
    </svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <path d="M12 14.5v2.2" />
    </svg>
  );
}

export function IconFilm(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7.5 4.5v15" />
      <path d="M16.5 4.5v15" />
      <path d="M3.5 9h4" />
      <path d="M3.5 15h4" />
      <path d="M16.5 9h4" />
      <path d="M16.5 15h4" />
    </svg>
  );
}

export function IconBolt(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M13.2 3.5L5 13.4h5.4l-1 7.1 8.6-10.4h-5.6l.8-6.6Z" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.5V12l3 2.2" />
    </svg>
  );
}

export function IconMail(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M4.5 7.5l7.5 6 7.5-6" />
    </svg>
  );
}

export function IconInstagram(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M16.8 7.2h.01" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconMark(props: IconProps) {
  /**
   * ClipMint wordmark glyph — a clipped film frame: the top-right corner is
   * "snipped" off as if by the auto-cutter, with a caption bar slicing
   * through it. Stroke-based, reads at 18–28px next to the wordmark.
   */
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.5 4.5h8.4L20.5 10.1v7.4l-4.2 4.2H6.5l-4.2-4.2V8.7L6.5 4.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 4.5L10.8 9H17l-5.6 6.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}