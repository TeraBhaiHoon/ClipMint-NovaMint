"use client";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { Mail, MapPin, Clock, Send } from "lucide-react";
import { useState } from "react";

export default function ContactPage() {
    const [form, setForm] = useState({
        name: "",
        email: "",
        subject: "",
        message: "",
    });
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSending(true);
        setError("");

        try {
            const res = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });
            if (!res.ok) throw new Error("Failed to send");
            setSent(true);
            setForm({ name: "", email: "", subject: "", message: "" });
        } catch {
            setError(
                "Failed to send message. Please email us directly at ClipMint.Support@gmail.com"
            );
        } finally {
            setSending(false);
        }
    }

    return (
        <main className="overflow-hidden min-h-screen bg-[#030305] text-[#f8fafc]">
            <Navbar />

            <div className="max-w-5xl mx-auto px-6 pt-36 pb-24 md:pt-44 md:pb-36 relative">
                {/* Ambient glow */}
                <div className="absolute w-[280px] h-[280px] rounded-full bg-mint-500/5 blur-[90px] pointer-events-none top-20 right-1/4" />

                <div className="text-center mb-16">
                    <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 leading-tight">
                        Get In <span className="gradient-text bg-text-mint-400">Touch</span>
                    </h1>
                    <p className="text-base sm:text-lg text-slate-400 max-w-md mx-auto leading-relaxed">
                        Have a question, suggestion, or need help? We'd love to hear from you.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
                    {/* Contact info */}
                    <div className="flex flex-col gap-6">
                        {[
                            {
                                icon: <Mail size={20} />,
                                title: "Email",
                                value: "ClipMint.Support@gmail.com",
                                href: "mailto:ClipMint.Support@gmail.com",
                            },
                            {
                                icon: <MapPin size={20} />,
                                title: "Address",
                                value: "Jaipur, Rajasthan, India",
                            },
                            {
                                icon: <Send size={20} />,
                                title: "Founder",
                                value: "VIKASH MEENA",
                            },
                            {
                                icon: <Clock size={20} />,
                                title: "Support Hours",
                                value: "Mon – Sat, 10 AM – 7 PM IST",
                            },
                        ].map((info) => (
                            <div
                                key={info.title}
                                className="glass-card p-6 flex items-start gap-4"
                            >
                                <div className="w-11 h-11 rounded-xl bg-mint-500/10 flex items-center justify-center text-mint-400 border border-mint-500/20 flex-shrink-0">
                                    {info.icon}
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-mint-400 tracking-wider uppercase mb-1">
                                        {info.title}
                                    </div>
                                    {info.href ? (
                                        <a
                                            href={info.href}
                                            className="text-slate-200 hover:text-mint-300 no-underline text-base font-semibold transition-colors"
                                        >
                                            {info.value}
                                        </a>
                                    ) : (
                                        <div className="text-slate-200 text-base font-semibold">
                                            {info.value}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        <div className="glass-card p-6 bg-mint-500/5">
                            <div className="text-sm font-bold text-slate-300 mb-2">
                                Follow us
                            </div>
                            <a
                                href="https://instagram.com/clipmintapp"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-mint-300 hover:text-mint-400 no-underline text-xs sm:text-sm font-medium transition-colors"
                            >
                                @ClipMintApp on Instagram →
                            </a>
                        </div>
                    </div>

                    {/* Contact form */}
                    <div className="glass-card p-8 md:p-10 shadow-xl">
                        {sent ? (
                            <div className="text-center py-12 px-4 flex flex-col items-center gap-4 animate-scale-in">
                                <div className="text-5xl">✉️</div>
                                <h3 className="text-2xl font-bold text-slate-200">
                                    Message Sent!
                                </h3>
                                <p className="text-sm text-slate-400 max-w-xs mx-auto leading-relaxed">
                                    We'd love to help you. We will get back to you within 24 hours.
                                </p>
                                <button
                                    className="btn-secondary mt-6 py-2.5 px-6 text-sm"
                                    onClick={() => setSent(false)}
                                >
                                    Send Another
                                </button>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                                <h3 className="text-xl font-bold text-slate-200 mb-2 border-b border-white/5 pb-2">
                                    Send us a message
                                </h3>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-semibold text-slate-400">
                                        Your Name
                                    </label>
                                    <input
                                        className="input-field"
                                        placeholder="John Doe"
                                        value={form.name}
                                        onChange={(e) =>
                                            setForm({ ...form, name: e.target.value })
                                        }
                                        required
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-semibold text-slate-400">
                                        Email Address
                                    </label>
                                    <input
                                        className="input-field"
                                        type="email"
                                        placeholder="john@example.com"
                                        value={form.email}
                                        onChange={(e) =>
                                            setForm({ ...form, email: e.target.value })
                                        }
                                        required
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-semibold text-slate-400">
                                        Subject
                                    </label>
                                    <input
                                        className="input-field"
                                        placeholder="How can we help?"
                                        value={form.subject}
                                        onChange={(e) =>
                                            setForm({ ...form, subject: e.target.value })
                                        }
                                        required
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-semibold text-slate-400">
                                        Message
                                    </label>
                                    <textarea
                                        className="input-field min-h-[120px] resize-y"
                                        placeholder="Tell us what's on your mind..."
                                        value={form.message}
                                        onChange={(e) =>
                                            setForm({ ...form, message: e.target.value })
                                        }
                                        required
                                        rows={4}
                                    />
                                </div>

                                {error && (
                                    <p className="text-red-400 text-xs font-semibold mt-2 animate-scale-in">
                                        {error}
                                    </p>
                                )}

                                <button
                                    type="submit"
                                    className="btn-primary w-full py-3.5 mt-2 text-sm font-semibold flex items-center justify-center gap-2 shadow-lg"
                                    disabled={sending}
                                >
                                    {sending ? (
                                        "Sending..."
                                    ) : (
                                        <>
                                            <Send size={15} />
                                            <span>Send Message</span>
                                        </>
                                    )}
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            </div>

            <Footer />
        </main>
    );
}
