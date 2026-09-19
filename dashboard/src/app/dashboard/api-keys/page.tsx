"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import {
    Key, Plus, Copy, Trash2, Shield, Loader2, Check,
    AlertCircle, Code2, ChevronDown, ChevronUp,
    Terminal, AlertTriangle, Activity,
} from "lucide-react";

interface ApiKeyRow {
    id: string;
    name: string;
    key_prefix: string;
    created_at: string;
    last_used_at: string | null;
    requests_today: number;
    is_active: boolean;
}

function timeAgo(date: string): string {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
}

const CODE_SNIPPETS = [
    {
        lang: "cURL",
        code: `curl -X POST https://clipmint.vikashbuilds.in/api/v1/jobs \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"video_url": "https://youtube.com/watch?v=...", "caption_style": "hormozi", "max_clips": 5}'`,
    },
    {
        lang: "JavaScript",
        code: `const response = await fetch("https://clipmint.vikashbuilds.in/api/v1/jobs", {
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
const data = await response.json();`,
    },
    {
        lang: "Python",
        code: `import requests

response = requests.post(
    "https://clipmint.vikashbuilds.in/api/v1/jobs",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "video_url": "https://youtube.com/watch?v=...",
        "caption_style": "hormozi",
        "max_clips": 5,
    },
)
data = response.json()`,
    },
];

export default function ApiKeysPage() {
    const supabase = createClient();
    const [keys, setKeys] = useState<ApiKeyRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newKeyName, setNewKeyName] = useState("");
    const [creating, setCreating] = useState(false);
    const [newRawKey, setNewRawKey] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showSnippets, setShowSnippets] = useState(false);
    const [activeSnippet, setActiveSnippet] = useState(0);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [copiedPrefix, setCopiedPrefix] = useState<string | null>(null);

    useEffect(() => {
        loadKeys();
    }, []);

    async function loadKeys() {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
            .from("api_keys")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false });

        if (data) setKeys(data as ApiKeyRow[]);
        setLoading(false);
    }

    async function createKey() {
        if (!newKeyName.trim()) return;
        setCreating(true);
        setError(null);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setError("Not authenticated"); setCreating(false); return; }

        const rawKey = `cm_live_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const keyPrefix = rawKey.slice(0, 12);

        const encoder = new TextEncoder();
        const data = encoder.encode(rawKey);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

        const { error: insertError } = await supabase
            .from("api_keys")
            .insert({ user_id: user.id, key_hash: keyHash, key_prefix: keyPrefix, name: newKeyName.trim() });

        if (insertError) { setError(insertError.message); setCreating(false); return; }

        setNewRawKey(rawKey);
        setCreating(false);
        await loadKeys();
    }

    async function deleteKey(keyId: string) {
        const { error: delError } = await supabase.from("api_keys").delete().eq("id", keyId);
        if (!delError) setKeys((prev) => prev.filter((k) => k.id !== keyId));
        setDeleteConfirm(null);
    }

    function closeModal() {
        setShowCreateModal(false);
        setNewKeyName("");
        setNewRawKey(null);
        setCopied(false);
        setError(null);
    }

    const totalRequests = keys.reduce((sum, k) => sum + k.requests_today, 0);
    const activeKeys = keys.filter((k) => k.is_active).length;

    return (
        <div>
            {/* ─── Header ─── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-100 mb-1">API Keys</h1>
                    <p className="text-sm text-[#64748b]">
                        Manage API keys for programmatic access to ClipMint
                    </p>
                </div>
                <button className="btn-primary py-2.5 px-5 text-sm font-semibold flex items-center gap-2 shadow-lg" onClick={() => setShowCreateModal(true)}>
                    <Plus size={16} /> Create Key
                </button>
            </div>

            {/* ─── API Overview Stats ─── */}
            <div className="dash-grid-3 mb-6">
                <div className="stat-card">
                    <div className="flex justify-between items-center mb-2.5">
                        <span className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">Active Keys</span>
                        <div className="stat-icon-bg bg-mint-500/10 border border-mint-500/10">
                            <Key size={18} className="text-mint-400" />
                        </div>
                    </div>
                    <div className="text-3xl font-bold tracking-tight text-slate-100">{loading ? <div className="skeleton h-8 w-10" /> : activeKeys}</div>
                </div>
                <div className="stat-card">
                    <div className="flex justify-between items-center mb-2.5">
                        <span className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">Requests Today</span>
                        <div className="stat-icon-bg bg-[#10b981]/10 border border-[#10b981]/10">
                            <Activity size={18} className="text-[#10b981]" />
                        </div>
                    </div>
                    <div className="text-3xl font-bold tracking-tight text-slate-100">{loading ? <div className="skeleton h-8 w-10" /> : totalRequests}</div>
                </div>
                <div className="stat-card">
                    <div className="flex justify-between items-center mb-2.5">
                        <span className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">Total Keys</span>
                        <div className="stat-icon-bg bg-mint-500/10 border border-mint-500/3010">
                            <Shield size={18} className="text-mint-400" />
                        </div>
                    </div>
                    <div className="text-3xl font-bold tracking-tight text-slate-100">{loading ? <div className="skeleton h-8 w-10" /> : keys.length}</div>
                </div>
            </div>

            {/* ─── Documentation Info ─── */}
            <div className="glass-card p-5 mb-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="flex items-start gap-3">
                        <Code2 size={20} className="text-mint-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <div className="text-sm font-semibold text-slate-200 mb-1">API Documentation</div>
                            <p className="text-xs text-slate-400 leading-relaxed">
                                Use your API key in the <code className="bg-[#08080c] border border-white/5 px-1.5 py-0.5 rounded font-mono text-[11px] text-slate-300">Authorization: Bearer cm_****</code> header.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowSnippets(!showSnippets)}
                        className="btn-secondary text-xs px-3.5 py-2 flex items-center gap-1.5 cursor-pointer"
                    >
                        <Terminal size={13} />
                        {showSnippets ? "Hide" : "Show"} Examples
                        {showSnippets ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                </div>

                {/* Code Snippets */}
                {showSnippets && (
                    <div className="mt-4 animate-fade-in-up">
                        <div className="tab-nav mb-3">
                            {CODE_SNIPPETS.map((snippet, i) => (
                                <button
                                    key={snippet.lang}
                                    className={`tab-item text-xs px-3 py-1.5 ${activeSnippet === i ? "active" : ""}`}
                                    onClick={() => setActiveSnippet(i)}
                                >
                                    {snippet.lang}
                                </button>
                            ))}
                        </div>
                        <div className="code-block">
                            <span className="code-lang">{CODE_SNIPPETS[activeSnippet].lang}</span>
                            <pre className="whitespace-pre-wrap break-all m-0">
                                {CODE_SNIPPETS[activeSnippet].code}
                            </pre>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(CODE_SNIPPETS[activeSnippet].code);
                                    setCopiedPrefix("snippet");
                                    setTimeout(() => setCopiedPrefix(null), 2000);
                                }}
                                className="absolute top-2 right-12 bg-[#0d0c12] border border-white/5 hover:border-mint-500/35 rounded-lg px-2.5 py-1.5 cursor-pointer text-[#64748b] hover:text-slate-200 text-[10px] flex items-center gap-1 transition-all"
                            >
                                {copiedPrefix === "snippet" ? <><Check size={11} className="text-[#10b981]" /> Copied</> : <><Copy size={11} /> Copy</>}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ─── Keys List ─── */}
            {loading ? (
                <div className="flex flex-col gap-3">
                    {[1, 2].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
                </div>
            ) : keys.length === 0 ? (
                <div className="glass-card p-12 text-center max-w-md mx-auto">
                    <Key size={40} className="text-[#64748b] opacity-40 mb-4 mx-auto" />
                    <h3 className="text-base font-bold text-slate-200 mb-2">No API Keys Yet</h3>
                    <p className="text-sm text-[#64748b] mb-5 leading-relaxed">
                        Create your first API key to start using ClipMint programmatically
                    </p>
                    <button className="btn-primary py-2.5 px-5 text-sm font-semibold flex items-center gap-2 shadow-lg" onClick={() => setShowCreateModal(true)}>
                        <Plus size={16} /> Create Your First Key
                    </button>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {keys.map((key, i) => (
                        <div
                            key={key.id}
                            className="glass-card p-5 animate-fade-in-up"
                            style={{ animationDelay: `${i * 0.05}s` }}
                        >
                            <div className="flex justify-between items-center flex-wrap gap-4">
                                <div className="flex items-center gap-3.5 flex-1 min-w-0">
                                    {/* Status dot */}
                                    <div 
                                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                            key.is_active 
                                                ? "bg-[#10b981] shadow-[0_0_8px_rgba(16,185,129,0.4)]" 
                                                : "bg-[#64748b]"
                                        }`} 
                                    />
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-slate-200 mb-1">{key.name}</div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <code className="text-xs text-[#64748b] bg-[#08080c] px-2.5 py-1 rounded-md border border-white/5 font-mono">
                                                {key.key_prefix}••••••••••••
                                            </code>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(key.key_prefix);
                                                    setCopiedPrefix(key.id);
                                                    setTimeout(() => setCopiedPrefix(null), 2000);
                                                }}
                                                className="bg-transparent border-none cursor-pointer p-1 text-[#64748b] hover:text-[#10b981] flex items-center gap-1 text-[10px] font-semibold transition-colors"
                                            >
                                                {copiedPrefix === key.id ? <><Check size={12} /> Copied</> : <Copy size={12} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 flex-shrink-0 ml-auto sm:ml-0">
                                    <div className="text-left sm:text-right">
                                        <div className="text-xs text-slate-300 font-semibold">
                                            {key.requests_today} requests today
                                        </div>
                                        <div className="text-[10px] text-[#64748b]">
                                            {key.last_used_at ? `Last used ${timeAgo(key.last_used_at)}` : "Never used"}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setDeleteConfirm(key.id)}
                                        className="bg-transparent border border-red-500/20 hover:border-red-500/40 hover:bg-red-500/5 cursor-pointer text-[#ef4444] p-2 rounded-xl transition-all flex items-center justify-center"
                                        title="Delete key"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ─── Delete Confirmation Modal ─── */}
            {deleteConfirm && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-100"
                    onClick={() => setDeleteConfirm(null)}
                >
                    <div
                        className="glass-card animate-scale-in p-6 w-full max-w-sm mx-4 shadow-2xl border-white/5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0 text-[#ef4444]">
                                <AlertTriangle size={20} />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-100">Delete API Key</h3>
                                <p className="text-xs text-[#64748b] font-medium">
                                    {keys.find(k => k.id === deleteConfirm)?.name}
                                </p>
                            </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-red-500/5 border border-red-500/15 mb-5">
                            <p className="text-xs text-slate-300 leading-relaxed">
                                This action <strong className="text-[#ef4444] font-bold">cannot be undone</strong>. Any applications using this key will immediately lose access. Make sure to update your integrations before deleting.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button className="btn-secondary flex-1 justify-center py-2.5 text-xs font-semibold" onClick={() => setDeleteConfirm(null)}>
                                Cancel
                            </button>
                            <button
                                className="btn-primary flex-1 justify-center py-2.5 text-xs font-semibold bg-[#ef4444] hover:bg-red-600 shadow-lg shadow-red-600/15"
                                onClick={() => deleteKey(deleteConfirm)}
                            >
                                <Trash2 size={14} /> Delete Key
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Create Modal ─── */}
            {showCreateModal && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-100"
                    onClick={closeModal}
                >
                    <div
                        className="glass-card animate-scale-in p-8 w-full max-w-md mx-4 shadow-2xl border-white/5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {newRawKey ? (
                            <>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-9 h-9 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20 flex items-center justify-center flex-shrink-0 text-[#10b981]">
                                        <Check size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-bold text-slate-100">Key Created!</h3>
                                        <p className="text-xs text-[#64748b]">Copy this key now — you won&apos;t see it again</p>
                                    </div>
                                </div>
                                <div className="bg-[#030305] border border-white/5 p-4 rounded-xl font-mono text-xs break-all mb-5 text-slate-200">
                                    {newRawKey}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        className="btn-primary flex-1 justify-center py-2.5 text-xs font-semibold"
                                        onClick={() => { navigator.clipboard.writeText(newRawKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                                    >
                                        {copied ? <><Check size={16} /> Copied!</> : <><Copy size={16} /> Copy Key</>}
                                    </button>
                                    <button className="btn-secondary flex-1 justify-center py-2.5 text-xs font-semibold" onClick={closeModal}>
                                        Done
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 className="text-lg font-bold text-slate-100 mb-1.5">Create API Key</h3>
                                <p className="text-xs text-[#64748b] mb-5">
                                    Give your key a descriptive name to easily identify it later
                                </p>
                                <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
                                    Key Name
                                </label>
                                <input
                                    type="text" value={newKeyName}
                                    onChange={(e) => setNewKeyName(e.target.value)}
                                    placeholder="e.g. Production, Development, My App"
                                    className="input-field mb-5"
                                    autoFocus
                                />
                                {error && (
                                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[#ef4444] text-xs font-semibold mb-4 flex items-center gap-2 animate-scale-in">
                                        <AlertCircle size={14} className="flex-shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                )}
                                <div className="flex gap-3">
                                    <button className="btn-secondary flex-1 justify-center py-2.5 text-xs font-semibold" onClick={closeModal}>
                                        Cancel
                                    </button>
                                    <button
                                        className="btn-primary flex-1 justify-center py-2.5 text-xs font-semibold"
                                        disabled={creating || !newKeyName.trim()}
                                        onClick={createKey}
                                    >
                                        {creating ? <Loader2 size={16} className="animate-spin" /> : <><Key size={16} /> Create</>}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
