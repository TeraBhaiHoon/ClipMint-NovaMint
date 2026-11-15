"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Check, Code2, Copy, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { formatDate } from "@/lib/dashboard";
import { useDashboard } from "../_components/dashboard-provider";
import { Button, Dialog, EmptyState, LoadingState, Metrics, Notice, PageHeader, SectionHeading } from "../_components/ui";

interface ApiKeyRow {
    id: string; name: string; key_prefix: string; created_at: string;
    last_used_at: string | null; requests_today: number; is_active: boolean;
}
const SNIPPETS = [
    { language: "cURL", code: `curl -X POST https://clipmint.novamintnetworks.in/api/v1/jobs \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"video_url":"https://youtube.com/watch?v=...","caption_style":"hormozi","max_clips":5}'` },
    { language: "JavaScript", code: `const response = await fetch("https://clipmint.novamintnetworks.in/api/v1/jobs", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    video_url: "https://youtube.com/watch?v=...",
    caption_style: "hormozi",
    max_clips: 5,
  }),
});
const data = await response.json();` },
    { language: "Python", code: `import requests

response = requests.post(
    "https://clipmint.novamintnetworks.in/api/v1/jobs",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "video_url": "https://youtube.com/watch?v=...",
        "caption_style": "hormozi",
        "max_clips": 5,
    },
)
data = response.json()` },
];

export default function ApiKeysPage() {
    const supabase = useMemo(() => createClient(), []);
    const { account, loading: accountLoading, refreshProfile } = useDashboard();
    const [keys, setKeys] = useState<ApiKeyRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [showCreate, setShowCreate] = useState(false);
    const [name, setName] = useState("");
    const [rawKey, setRawKey] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [deleteKey, setDeleteKey] = useState<ApiKeyRow | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [dialogError, setDialogError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [snippet, setSnippet] = useState(0);

    const loadKeys = useCallback(async () => {
        if (!account) return;
        const { data, error } = await supabase.from("api_keys").select("id,name,key_prefix,created_at,last_used_at,requests_today,is_active").eq("user_id", account.id).order("created_at", { ascending: false });
        if (error) throw error;
        return (data || []) as ApiKeyRow[];
    }, [account, supabase]);

    useEffect(() => {
        if (!account) return;
        let disposed = false;
        async function load() {
            setLoading(true);
            setLoadError(null);
            try { const rows = await loadKeys(); if (!disposed) setKeys(rows || []); }
            catch { if (!disposed) setLoadError("API keys couldn’t be loaded. Please try again."); }
            finally { if (!disposed) setLoading(false); }
        }
        void load();
        return () => { disposed = true; };
    }, [account, loadKeys, retry]);

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(null), 2200);
        return () => clearTimeout(timer);
    }, [copied]);

    async function copy(value: string, identity: string) {
        try { await navigator.clipboard.writeText(value); setCopied(identity); }
        catch { setFeedback({ tone: "error", text: "Clipboard access was blocked. Select and copy the text manually." }); }
    }

    async function createKey(event: React.FormEvent) {
        event.preventDefault();
        if (!name.trim() || creating || !account) return;
        setCreating(true);
        setDialogError(null);
        try {
            const key = `cm_live_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
            const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
            const { data, error } = await supabase.from("api_keys").insert({ user_id: account.id, key_hash: hash, key_prefix: key.slice(0, 12), name: name.trim() }).select("id,name,key_prefix,created_at,last_used_at,requests_today,is_active").single();
            if (error || !data) throw error || new Error("Missing key record");
            setRawKey(key);
            setKeys((old) => [data as ApiKeyRow, ...old]);
        } catch { setDialogError("Your key couldn’t be created. Please try again."); }
        finally { setCreating(false); }
    }

    async function removeKey() {
        if (!deleteKey || !account || deleting) return;
        setDeleting(true);
        setDialogError(null);
        try {
            const { error } = await supabase.from("api_keys").delete().eq("id", deleteKey.id).eq("user_id", account.id);
            if (error) throw error;
            setKeys((old) => old.filter((item) => item.id !== deleteKey.id));
            setFeedback({ tone: "success", text: "API key deleted. Applications using it no longer have access." });
            setDeleteKey(null);
        } catch { setDialogError("The key couldn’t be deleted. Please try again."); }
        finally { setDeleting(false); }
    }

    function closeCreate() {
        if (creating) return;
        setShowCreate(false);
        setRawKey(null);
        setName("");
        setDialogError(null);
        setCopied(null);
    }

    const pending = accountLoading || loading;
    return <div className="studio-page">
        <PageHeader eyebrow="Connect your workflow" title="API keys" description="Create secure keys to connect ClipMint to your own tools and automations."
            actions={<Button onClick={() => { setShowCreate(true); setDialogError(null); }} disabled={!account}><Plus size={17} aria-hidden="true" />Create key</Button>} />
        {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
        <Metrics loading={pending} items={[
            { label: "Active keys", value: keys.filter((key) => key.is_active).length, icon: KeyRound },
            { label: "Requests today", value: keys.reduce((sum, key) => sum + (key.requests_today || 0), 0), icon: Activity },
            { label: "Total keys", value: keys.length, icon: ShieldCheck },
        ]} />
        <section className="studio-panel"><SectionHeading title="Your keys" description="Keep keys private. Only the prefix is shown after creation." icon={KeyRound} />
            {!account && !accountLoading ? <Notice tone="error" action={<Button variant="secondary" onClick={() => void refreshProfile()}>Refresh account</Button>}>Your account is temporarily unavailable.</Notice> : pending ? <LoadingState label="Loading API keys" rows={2} /> : loadError ? <Notice tone="error" action={<Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</Button>}>{loadError}</Notice> : !keys.length ? <EmptyState icon={KeyRound} title="Connect your first tool" description="Create an API key, store it securely, and include it in your requests." action={<Button onClick={() => setShowCreate(true)}><Plus size={17} aria-hidden="true" />Create your first key</Button>} /> : <ul className="studio-key-list">{keys.map((key) => <li key={key.id}>
                <span className="studio-key-symbol"><KeyRound size={21} aria-hidden="true" /></span>
                <div className="studio-key-info"><strong>{key.name}</strong><code>{key.key_prefix}••••••••••••</code><p>Created {formatDate(key.created_at)}{key.last_used_at ? ` · Last used ${formatDate(key.last_used_at)}` : " · Not used yet"}</p></div>
                <div className="studio-key-stats"><span className={`studio-badge studio-badge--${key.is_active ? "success" : "neutral"}`}>{key.is_active ? "Active" : "Inactive"}</span><p>{key.requests_today || 0} requests today</p></div>
                <Button variant="ghost" className="studio-icon-button studio-delete-key" aria-label={`Delete key ${key.name}`} title="Delete key" onClick={() => { setDeleteKey(key); setDialogError(null); }}><Trash2 size={18} aria-hidden="true" /></Button>
            </li>)}</ul>}
        </section>
        <section className="studio-panel"><SectionHeading title="Make your first request" description="Replace YOUR_API_KEY with your key. Never include a key in public client-side code." icon={Code2} />
            <div className="studio-code-toolbar"><div className="studio-segmented" role="group" aria-label="Code example language">{SNIPPETS.map((item, index) => <button type="button" key={item.language} aria-pressed={snippet === index} onClick={() => setSnippet(index)}>{item.language}</button>)}</div><Button variant="ghost" onClick={() => void copy(SNIPPETS[snippet].code, "snippet")}><Copy size={16} aria-hidden="true" />{copied === "snippet" ? "Copied" : "Copy example"}</Button></div>
            <pre className="studio-code"><code>{SNIPPETS[snippet].code}</code></pre>
        </section>
        <Dialog open={showCreate} onClose={closeCreate} busy={creating} title={rawKey ? "Your key is ready" : "Create an API key"} description={rawKey ? "Copy this key now. It won’t be shown again after you close this dialog." : "Give the key a name that describes the tool or environment."}
            actions={rawKey ? <><Button variant="secondary" onClick={closeCreate}>Done</Button><Button onClick={() => void copy(rawKey, "key")}>{copied === "key" ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}{copied === "key" ? "Copied" : "Copy key"}</Button></> : <><Button variant="secondary" disabled={creating} onClick={closeCreate}>Cancel</Button><Button type="submit" form="create-api-key" disabled={!name.trim()} busy={creating}><KeyRound size={17} aria-hidden="true" />{creating ? "Creating…" : "Create key"}</Button></>}>
            {rawKey ? <div className="studio-stack"><code className="studio-raw-key">{rawKey}</code><Notice tone="warning">Store this key in a password manager or an environment variable. Anyone with it can use your ClipMint API access.</Notice></div> : <form id="create-api-key" onSubmit={createKey}><div className="studio-field"><label htmlFor="api-key-name">Key name</label><input id="api-key-name" className="studio-input" autoFocus value={name} maxLength={100} placeholder="e.g. Production automation" disabled={creating} onChange={(event) => setName(event.target.value)} required /></div></form>}
            {dialogError && <div className="studio-dialog-error"><Notice tone="error">{dialogError}</Notice></div>}
        </Dialog>
        <Dialog open={!!deleteKey} onClose={() => { if (!deleting) setDeleteKey(null); }} busy={deleting} title="Delete this API key?" description={deleteKey?.name} actions={<><Button variant="secondary" disabled={deleting} onClick={() => setDeleteKey(null)}>Keep key</Button><Button variant="danger" busy={deleting} onClick={() => void removeKey()}><Trash2 size={17} aria-hidden="true" />{deleting ? "Deleting…" : "Delete key"}</Button></>}>
            <Notice tone="warning">This can’t be undone. Applications using this key will immediately lose access. Update your integrations before deleting it.</Notice>{dialogError && <div className="studio-dialog-error"><Notice tone="error">{dialogError}</Notice></div>}
        </Dialog>
    </div>;
}
