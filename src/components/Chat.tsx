import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Send, Image as ImageIcon, Settings, Trash2, Bell, BellOff,
  X, Lock, Copy, Check, LogOut, RefreshCw, Users, ChevronDown,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { Message } from "../hooks/useChat";
import { ConnectionStatus } from "../hooks/useNostr";
import { cn } from "../lib/utils";

// ─── Bubble colour palette (one per device) ───────────────────────────────
const DEVICE_COLORS = [
  { bg: "#2b5bdb", tail: "#2b5bdb" },  // blue   (default / me)
  { bg: "#1a7a5e", tail: "#1a7a5e" },  // teal
  { bg: "#7c3aed", tail: "#7c3aed" },  // violet
  { bg: "#c05621", tail: "#c05621" },  // amber
  { bg: "#b91c55", tail: "#b91c55" },  // rose
  { bg: "#0e7490", tail: "#0e7490" },  // cyan
];
function deviceColorIdx(id = "") {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % DEVICE_COLORS.length;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function dateLabel(ts: number) {
  const d = new Date(ts);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMMM d, yyyy");
}

interface ChatProps {
  messages: Message[];
  onSendMessage: (text: string, type: "text" | "image") => void;
  status: ConnectionStatus;
  onClearHistory: () => void;
  sendError: string | null;
  onDismissSendError: () => void;
  onLogout: () => void;
  myDeviceId: string;
  participants: string[];
  peerError: string | null;
  onRetry: () => void;
}

export function Chat({
  messages, onSendMessage, status, onClearHistory,
  sendError, onDismissSendError, onLogout,
  myDeviceId, participants, peerError, onRetry,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  const scrollToBottom = useCallback((smooth = true) =>
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" }),
  []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Show "scroll to bottom" button when user scrolls up
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    try {
      if ("Notification" in window) setNotificationsEnabled(Notification.permission === "granted");
    } catch { /* ignore */ }
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 108) + "px";
  }, [input]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && status === "connected") {
      onSendMessage(input.trim(), "text");
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e as unknown as React.FormEvent); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => onSendMessage(ev.target?.result as string, "image");
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleNotifications = async () => {
    if (!("Notification" in window)) return;
    try {
      if (Notification.permission === "granted") setNotificationsEnabled(false);
      else if (Notification.permission !== "denied") {
        const p = await Notification.requestPermission();
        setNotificationsEnabled(p === "granted");
      }
    } catch { /* ignore */ }
  };

  const handleCopy = useCallback(async (text: string, id: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); }
    catch { /* ignore */ }
  }, []);

  // Build display list with date separators and grouping info
  type DisplayItem =
    | { kind: "separator"; label: string; key: string }
    | { kind: "msg"; msg: Message; isFirst: boolean; isLast: boolean; key: string };

  const displayItems: DisplayItem[] = [];
  let lastDate = "";
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const dateStr = format(msg.timestamp, "yyyy-MM-dd");
    if (dateStr !== lastDate) {
      displayItems.push({ kind: "separator", label: dateLabel(msg.timestamp), key: `sep-${dateStr}` });
      lastDate = dateStr;
    }
    const sameSenderPrev = prev && prev.sender === msg.sender &&
      msg.timestamp - prev.timestamp < 5 * 60 * 1000 &&
      format(prev.timestamp, "yyyy-MM-dd") === dateStr;
    const sameSenderNext = next && next.sender === msg.sender &&
      next.timestamp - msg.timestamp < 5 * 60 * 1000 &&
      format(next.timestamp, "yyyy-MM-dd") === dateStr;
    displayItems.push({
      kind: "msg", msg,
      isFirst: !sameSenderPrev,
      isLast: !sameSenderNext,
      key: msg.id,
    });
  }

  const totalParticipants = participants.length + 1;
  const isConnected = status === "connected";

  const statusText = isConnected ? `${totalParticipants} ${totalParticipants === 1 ? "device" : "devices"} connected`
    : status === "waiting" || status === "connecting" ? "Connecting to relays…"
    : status === "error" ? "Connection failed"
    : "Disconnected";

  return (
    <div className="flex flex-col select-none" style={{ height: "100dvh", background: "#0e1621" }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-3 pt-safe z-20 shrink-0"
              style={{ background: "#17212b", borderBottom: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 2px 12px rgba(0,0,0,0.4)" }}>
        {/* Avatar/Icon */}
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
             style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)", boxShadow: "0 0 16px rgba(43,91,219,0.4)" }}>
          <Lock className="w-4.5 h-4.5 text-white" strokeWidth={2} />
        </div>
        {/* Title + status */}
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-white leading-tight">SecureChat</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className={cn("w-1.5 h-1.5 rounded-full shrink-0",
              isConnected ? "bg-green-400" : status === "waiting" || status === "connecting" ? "bg-yellow-400 animate-pulse" : "bg-red-400"
            )} />
            <span className="text-xs text-slate-400 truncate">{statusText}</span>
            {isConnected && totalParticipants > 1 && (
              <><span className="text-slate-600 text-xs">·</span>
                <Users className="w-3 h-3 text-slate-500 shrink-0" /></>
            )}
          </div>
        </div>
        <button onClick={() => setShowSettings(!showSettings)}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/8 active:bg-white/12 transition-colors shrink-0"
                aria-label="Settings">
          <Settings className="w-5 h-5 text-slate-400" />
        </button>
      </header>

      {/* ── Error Banner ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {sendError && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden shrink-0"
                      style={{ background: "rgba(185,28,48,0.2)", borderBottom: "1px solid rgba(185,28,48,0.3)" }}>
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs text-red-300">{sendError}</span>
              <button onClick={onDismissSendError} className="ml-3 p-1 rounded-full hover:bg-red-900/40"><X className="w-3.5 h-3.5 text-red-400" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Connection Error Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {peerError && status === "error" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="fixed inset-0 z-50 flex items-center justify-center p-6"
                      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="max-w-sm w-full rounded-2xl p-6 text-center"
                        style={{ background: "#1f2d3d", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                   style={{ background: "rgba(185,28,48,0.2)" }}>
                <RefreshCw className="w-5 h-5 text-red-400" />
              </div>
              <p className="text-base font-semibold text-white mb-1">Relay unreachable</p>
              <p className="text-sm text-slate-400 mb-5">Could not connect to any relay server. Check your network.</p>
              <button onClick={onRetry}
                      className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98]"
                      style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)" }}>
                Retry Connection
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Settings Panel ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setShowSettings(false)}
                        className="fixed inset-0 z-30" style={{ background: "rgba(0,0,0,0.4)" }} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -8 }} transition={{ duration: 0.18 }}
                        className="absolute top-[68px] right-3 w-60 z-40 rounded-2xl overflow-hidden shadow-2xl"
                        style={{ background: "#1f2d3d", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Session</p>
              </div>
              {[
                {
                  icon: notificationsEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4 text-slate-500" />,
                  label: notificationsEnabled ? "Notifications On" : "Notifications Off",
                  onClick: toggleNotifications, danger: false,
                },
                {
                  icon: <Trash2 className="w-4 h-4" />,
                  label: "Clear Chat (all devices)",
                  onClick: () => setShowClearConfirm(true), danger: true,
                },
                {
                  icon: <LogOut className="w-4 h-4 text-slate-400" />,
                  label: "Leave Session",
                  onClick: () => { setShowSettings(false); onLogout(); }, danger: false,
                },
              ].map(item => (
                <button key={item.label} onClick={item.onClick}
                        className={cn("w-full flex items-center gap-3 px-4 py-3.5 text-sm text-left transition-colors min-h-[44px]",
                          item.danger ? "text-red-400 hover:bg-red-400/10" : "text-slate-200 hover:bg-white/5")}>
                  {item.icon}<span>{item.label}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Clear Confirm ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setShowClearConfirm(false)} className="absolute inset-0"
                        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }} />
            <motion.div initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.93, opacity: 0 }}
                        className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl"
                        style={{ background: "#1f2d3d", border: "1px solid rgba(255,255,255,0.08)" }}>
              <h3 className="text-base font-semibold text-white mb-1">Clear all messages?</h3>
              <p className="text-sm text-slate-400 mb-5 leading-relaxed">This will erase chat history on <strong className="text-white">every device</strong> in this session. Cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-3 rounded-xl text-sm font-medium text-white transition-colors"
                        style={{ background: "rgba(255,255,255,0.08)" }}>Cancel</button>
                <button onClick={() => { onClearHistory(); setShowClearConfirm(false); setShowSettings(false); }}
                        className="flex-1 py-3 rounded-xl text-sm font-medium text-white transition-colors active:scale-[0.98]"
                        style={{ background: "#dc2626" }}>Delete All</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Image Lightbox ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {previewImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      onClick={() => setPreviewImage(null)}
                      className="fixed inset-0 z-50 flex items-center justify-center p-4"
                      style={{ background: "rgba(0,0,0,0.92)" }}>
            <button className="absolute top-5 right-5 p-2.5 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
              <X className="w-5 h-5 text-white" />
            </button>
            <motion.img initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        onClick={e => e.stopPropagation()}
                        src={previewImage} alt="Preview"
                        className="max-w-full max-h-full object-contain rounded-lg" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Messages ────────────────────────────────────────────────────── */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-1"
           style={{ background: "#0e1621" }}>
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-600">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "#17212b" }}>
              <Lock className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-center">
              {status === "waiting" || status === "connecting"
                ? "Connecting to relay network…"
                : "Start the conversation.\nMessages are end-to-end encrypted."}
            </p>
          </div>
        ) : (
          displayItems.map(item => {
            if (item.kind === "separator") return (
              <div key={item.key} className="flex items-center gap-3 py-3">
                <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                <span className="text-[11px] text-slate-600 font-medium px-2">{item.label}</span>
                <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              </div>
            );

            const { msg, isFirst, isLast } = item;
            const isMe = msg.sender === "me";
            const devColor = DEVICE_COLORS[deviceColorIdx(isMe ? myDeviceId : (msg.senderDeviceId ?? ""))];

            // Bubble border-radius: flatten the side corner for grouped messages
            const br = isMe
              ? `16px 16px ${isLast ? "4px" : "16px"} 16px`
              : `16px 16px 16px ${isLast ? "4px" : "16px"}`;

            return (
              <motion.div key={item.key}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={cn("flex items-end gap-2 group", isMe ? "justify-end" : "justify-start",
                  isFirst ? "mt-3" : "mt-0.5")}
              >
                {/* Copy on hover (partner side) */}
                {!isMe && msg.type === "text" && (
                  <button onClick={() => handleCopy(msg.text, msg.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity mb-1 p-1.5 rounded-full"
                          style={{ background: "rgba(255,255,255,0.06)" }}>
                    {copiedId === msg.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                  </button>
                )}

                {/* Bubble */}
                <div className="relative max-w-[75vw] sm:max-w-[62%]">
                  <div className="px-3.5 py-2.5 select-text"
                       style={{
                         background: isMe ? devColor.bg : "#1f2d3d",
                         borderRadius: br,
                         boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                       }}>
                    {msg.type === "text" ? (
                      <div className="flex items-end gap-3 flex-wrap">
                        <p className="text-[15px] leading-[1.45] text-white whitespace-pre-wrap break-words flex-1 min-w-0">{msg.text}</p>
                        {isLast && (
                          <span className="text-[10px] shrink-0 self-end"
                                style={{ color: isMe ? "rgba(255,255,255,0.5)" : "rgba(148,163,184,0.6)", lineHeight: 1 }}>
                            {format(msg.timestamp, "HH:mm")}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div>
                        <img src={msg.text} alt="Image"
                             onClick={() => setPreviewImage(msg.text)}
                             className="rounded-xl max-w-full h-auto cursor-zoom-in block"
                             style={{ maxHeight: 280 }} />
                        {isLast && (
                          <div className="flex justify-end mt-1">
                            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>
                              {format(msg.timestamp, "HH:mm")}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bubble tail */}
                  {isLast && (
                    <div className="absolute bottom-0"
                         style={isMe
                           ? { right: -6, width: 0, height: 0, borderStyle: "solid", borderWidth: "0 0 10px 10px", borderColor: `transparent transparent ${devColor.tail} transparent` }
                           : { left: -6, width: 0, height: 0, borderStyle: "solid", borderWidth: "0 10px 10px 0", borderColor: "transparent #1f2d3d transparent transparent" }
                         } />
                  )}
                </div>

                {/* Copy on hover (my side) */}
                {isMe && msg.type === "text" && (
                  <button onClick={() => handleCopy(msg.text, msg.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity mb-1 p-1.5 rounded-full"
                          style={{ background: "rgba(255,255,255,0.06)" }}>
                    {copiedId === msg.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                  </button>
                )}
              </motion.div>
            );
          })
        )}
        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* Scroll-to-bottom button */}
      <AnimatePresence>
        {showScrollDown && (
          <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                         onClick={() => scrollToBottom()}
                         className="absolute bottom-24 right-4 z-20 w-10 h-10 rounded-full flex items-center justify-center shadow-lg"
                         style={{ background: "#17212b", border: "1px solid rgba(255,255,255,0.1)" }}>
            <ChevronDown className="w-5 h-5 text-slate-300" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Input Bar ────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-3 pb-safe" style={{ background: "#17212b", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <form onSubmit={handleSend} className="flex items-end gap-2 max-w-4xl mx-auto">
          {/* Attach */}
          <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-colors"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                  aria-label="Attach image">
            <ImageIcon className="w-4.5 h-4.5 text-slate-400" />
          </button>
          <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />

          {/* Text */}
          <div className="flex-1 flex items-end rounded-2xl px-4 py-2.5 transition-all"
               style={{ background: "#1f2d3d", border: "1px solid rgba(255,255,255,0.07)" }}>
            <textarea ref={textareaRef} value={input}
                      onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                      placeholder={status === "connected" ? "Write a message…" : "Connecting…"}
                      disabled={status !== "connected"}
                      rows={1}
                      className="flex-1 bg-transparent border-none outline-none resize-none text-[15px] text-white placeholder-slate-600 leading-[1.45] max-h-[108px] disabled:opacity-40" />
          </div>

          {/* Send */}
          <motion.button type="submit" disabled={!input.trim() || status !== "connected"}
                         whileTap={{ scale: 0.92 }}
                         className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-all"
                         style={{
                           background: input.trim() && status === "connected"
                             ? "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)"
                             : "rgba(255,255,255,0.06)",
                           boxShadow: input.trim() && status === "connected" ? "0 0 16px rgba(59,130,246,0.35)" : "none",
                         }} aria-label="Send">
            <Send className={cn("w-4.5 h-4.5 ml-0.5", input.trim() && status === "connected" ? "text-white" : "text-slate-600")} />
          </motion.button>
        </form>
      </div>
    </div>
  );
}
