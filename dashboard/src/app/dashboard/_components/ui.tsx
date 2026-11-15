"use client";

import { useEffect, useId, useRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
    AlertCircle, AlertTriangle, Check, CheckCircle2, Clock3, Film,
    Info, Loader2, X, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { JobStatus } from "@/lib/types";
import { boundedPercent } from "@/lib/dashboard";

export function PageHeader({ eyebrow, title, description, actions, children }: {
    eyebrow?: string; title: string; description?: string; actions?: ReactNode; children?: ReactNode;
}) {
    return (
        <header className="studio-page-header">
            <div className="studio-heading-group">
                {eyebrow && <p className="studio-eyebrow">{eyebrow}</p>}
                <h1>{title}</h1>
                {description && <p className="studio-page-description">{description}</p>}
                {children}
            </div>
            {actions && <div className="studio-header-actions">{actions}</div>}
        </header>
    );
}

export function SectionHeading({ title, description, icon: Icon, action }: {
    title: string; description?: string; icon?: LucideIcon; action?: ReactNode;
}) {
    return (
        <div className="studio-section-heading">
            <div>
                <h2>{Icon && <Icon size={18} aria-hidden="true" />}{title}</h2>
                {description && <p>{description}</p>}
            </div>
            {action}
        </div>
    );
}

export function Button({ children, variant = "primary", busy, className = "", disabled, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean;
}) {
    return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={`studio-button studio-button--${variant} ${className}`}>
        {busy && <Loader2 size={17} className="studio-spin" aria-hidden="true" />}{children}
    </button>;
}

export function Notice({ title, children, tone = "info", action }: {
    title?: string; children: ReactNode; tone?: "info" | "error" | "warning" | "success"; action?: ReactNode;
}) {
    const Icon = { info: Info, error: AlertCircle, warning: AlertTriangle, success: CheckCircle2 }[tone];
    return (
        <div className={`studio-notice studio-notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
            <Icon size={19} aria-hidden="true" />
            <div>{title && <strong>{title}</strong>}<div>{children}</div></div>
            {action && <div className="studio-notice-action">{action}</div>}
        </div>
    );
}

export function EmptyState({ icon: Icon = Film, title, description, action }: {
    icon?: LucideIcon; title: string; description: string; action?: ReactNode;
}) {
    return <div className="studio-empty">
        <div className="studio-empty-icon"><Icon size={26} aria-hidden="true" /></div>
        <h3>{title}</h3><p>{description}</p>{action}
    </div>;
}

export function LoadingState({ label = "Loading your workspace", rows = 3 }: { label?: string; rows?: number }) {
    return <div className="studio-loading" role="status" aria-label={label}>
        <span className="studio-sr-only">{label}</span>
        {Array.from({ length: rows }, (_, i) => <div key={i} className="studio-loading-row" aria-hidden="true"><span /><div><i /><i /></div></div>)}
    </div>;
}

export type Metric = { label: string; value: ReactNode; hint?: string; icon: LucideIcon };
export function Metrics({ items, loading = false }: { items: Metric[]; loading?: boolean }) {
    return <dl className="studio-metrics" style={{ "--metric-count": items.length } as React.CSSProperties} aria-label="Summary">
        {items.map(({ label, value, hint, icon: Icon }) => <div className="studio-metric" key={label}>
            <dt><Icon size={17} aria-hidden="true" />{label}</dt>
            <dd>{loading ? <span className="studio-number-skeleton" aria-label="Loading" /> : value}</dd>
            {hint && <p>{hint}</p>}
        </div>)}
    </dl>;
}

const STATUS: Record<JobStatus, { label: string; tone: string; icon: LucideIcon }> = {
    queued: { label: "Queued", tone: "neutral", icon: Clock3 },
    downloading: { label: "Downloading", tone: "running", icon: Loader2 },
    transcribing: { label: "Transcribing", tone: "running", icon: Loader2 },
    analyzing: { label: "Analyzing", tone: "running", icon: Loader2 },
    clipping: { label: "Clipping", tone: "running", icon: Loader2 },
    captioning: { label: "Captioning", tone: "running", icon: Loader2 },
    uploading: { label: "Uploading", tone: "running", icon: Loader2 },
    done: { label: "Completed", tone: "success", icon: CheckCircle2 },
    failed: { label: "Failed", tone: "error", icon: XCircle },
    cancelled: { label: "Cancelled", tone: "neutral", icon: AlertCircle },
};

export function StatusBadge({ status }: { status: JobStatus }) {
    const state = STATUS[status] || STATUS.queued;
    const Icon = state.icon;
    return <span className={`studio-badge studio-badge--${state.tone}`}><Icon size={14} aria-hidden="true" className={state.tone === "running" ? "studio-spin" : undefined} />{state.label}</span>;
}

export function UsageMeter({ label, used, limit, suffix = "used" }: { label: string; used: number; limit: number; suffix?: string }) {
    const percent = boundedPercent(used, limit);
    return <div className="studio-usage-meter">
        <div className="studio-usage-caption"><span>{label}</span><span><strong>{used.toLocaleString("en-IN")}</strong> / {limit.toLocaleString("en-IN")} {suffix}</span></div>
        <div className={`studio-meter ${percent >= 100 ? "studio-meter--full" : ""}`} role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
    </div>;
}

export function Choice({ selected, title, description, icon: Icon, onClick, children, disabled = false }: {
    selected: boolean; title: string; description?: string; icon?: LucideIcon;
    onClick: () => void; children?: ReactNode; disabled?: boolean;
}) {
    return <button type="button" aria-pressed={selected} disabled={disabled} onClick={onClick} className={`studio-choice ${selected ? "is-selected" : ""}`}>
        {children}
        <span className="studio-choice-heading">{Icon && <Icon size={18} aria-hidden="true" />}<strong>{title}</strong><span className="studio-choice-check" aria-hidden="true">{selected && <Check size={13} />}</span></span>
        {description && <span className="studio-choice-description">{description}</span>}
    </button>;
}

export function Toggle({ label, description, checked, onChange, disabled = false }: {
    label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
    const id = useId();
    return <div className="studio-toggle-row">
        <div><label htmlFor={id}>{label}</label>{description && <p id={`${id}-description`}>{description}</p>}</div>
        <input id={id} type="checkbox" role="switch" className="studio-switch" aria-describedby={description ? `${id}-description` : undefined} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>;
}

export function Dialog({ open, onClose, title, description, children, actions, wide = false, busy = false }: {
    open: boolean; onClose: () => void; title: string; description?: string;
    children: ReactNode; actions?: ReactNode; wide?: boolean; busy?: boolean;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const descriptionId = useId();
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (!open) {
            if (dialog.open) dialog.close();
            return;
        }
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        if (!dialog.open) dialog.showModal();
        document.body.style.overflow = "hidden";
        return () => {
            if (dialog.open) dialog.close();
            document.body.style.overflow = previousOverflow;
            if (focused?.isConnected) focused.focus();
        };
    }, [open]);

    return <dialog ref={ref} className={`studio-dialog ${wide ? "studio-dialog--wide" : ""}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
        onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
        onClick={(event) => { if (event.target === event.currentTarget && !busy) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
        <div className="studio-dialog-heading"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><Button variant="ghost" className="studio-icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={19} aria-hidden="true" /></Button></div>
        <div className="studio-dialog-body">{children}</div>
        {actions && <div className="studio-dialog-actions">{actions}</div>}
    </dialog>;
}
