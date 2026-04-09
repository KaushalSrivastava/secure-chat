import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Image as ImageIcon,
  Settings,
  Trash2,
  Bell,
  BellOff,
  X,
  Lock,
  Copy,
  Check,
  CheckCheck,
  LogOut,
  RefreshCw,
  Users,
  ChevronDown,
  Timer,
  Download,
  Sparkles,
  CornerDownLeft,
  Smile,
  Mic,
  Square,
  Play
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { Message } from "../hooks/useChat";
import { ConnectionStatus } from "../hooks/useSocket";
import { cn } from "../lib/utils";

const EMOJI_LIST = ["❤️", "😂", "😮", "😢", "👍", "🔥"];

function dateLabel(ts: number) {
  const d = new Date(ts);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMMM d, yyyy");
}

const isEmojiOnly = (text: string) => {
  const emojiRegex =
    /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})(\s*(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic}))*$/u;
  return text.trim().length <= 15 && emojiRegex.test(text.trim());
};

const BURN_OPTIONS = [null, 15, 60, 3600]; // Off, 15s, 1m, 1h
const BURN_LABELS: Record<string, string> = { "15": "15s", "60": "1m", "3600": "1h" };

interface ChatProps {
  messages: Message[];
  myDeviceId: string;
  participants: string[];
  typingUsers: string[];
  profiles: Record<string, {nickname: string, country?: string, timezone?: string}>;
  status: ConnectionStatus;
  sendError: string | null;
  peerError: string | null;

  onSendMessage: (
    text: string,
    type: "text" | "image" | "audio",
    opts?: { expiresIn?: number, replyToId?: string, audioDuration?: number }
  ) => void;
  onClearHistory: () => void;
  onClearMsg: (id: string) => void;
  onSyncReq: () => void;
  onTyping: (isTyping: boolean) => void;
  onReaction: (msgId: string, emoji: string) => void;
  onDismissSendError: () => void;
  onLogout: () => void;
  onRetry: () => void;
}

export function Chat({
  messages, myDeviceId, participants, typingUsers, profiles,
  status, sendError, peerError,
  onSendMessage, onClearHistory, onClearMsg, onSyncReq, onTyping, onReaction, onDismissSendError, onLogout, onRetry
}: ChatProps) {
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ id: string; src: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showNetworkHub, setShowNetworkHub] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [burnIdx, setBurnIdx] = useState(0);

  // Customization State
  const [themeMode, setThemeMode] = useState<"twilight" | "midnight" | "dawn">("twilight");
  const [bgPattern, setBgPattern] = useState<"doodle" | "dots" | "none">("doodle");

  // New Features State
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [reactingToId, setReactingToId] = useState<string | null>(null);
  
  // Audio state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartTimeRef = useRef<number>(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback((smooth = true) => messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" }), []);
  
  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const handleSync = () => {
    setIsSyncing(true); onSyncReq();
    setTimeout(() => setIsSyncing(false), 1000);
  };

  const toggleNotifications = async () => {
    if (!("Notification" in window)) return;
    try {
      if (Notification.permission === "granted") setNotificationsEnabled(false);
      else if (Notification.permission !== "denied") {
        const p = await Notification.requestPermission();
        setNotificationsEnabled(p === "granted");
      }
    } catch {
      /* ignore */
    }
  };

  const handleCopy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try { if ("Notification" in window) setNotificationsEnabled(Notification.permission === "granted"); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 108) + "px";
  }, [input]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    onTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), 2000);
  };

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (input.trim() && status === "connected") {
      onSendMessage(input.trim(), "text", {
        expiresIn: BURN_OPTIONS[burnIdx] || undefined,
        replyToId: replyingToId || undefined
      });
      setInput("");
      setReplyingToId(null);
      onTyping(false);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape') {
      setReplyingToId(null);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onSendMessage(ev.target?.result as string, "image", {
        expiresIn: BURN_OPTIONS[burnIdx] || undefined,
        replyToId: replyingToId || undefined
      });
      setReplyingToId(null);
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // --- Audio Recording Features ---
  const handleStartRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: audioChunksRef.current[0]?.type || 'audio/webm' });
        const duration = Math.floor((Date.now() - recordStartTimeRef.current) / 1000);
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64AudioMessage = reader.result as string;
          onSendMessage(base64AudioMessage, "audio", {
            expiresIn: BURN_OPTIONS[burnIdx] || undefined,
            replyToId: replyingToId || undefined,
            audioDuration: duration
          });
          setReplyingToId(null);
        };
        // Close microphone stream
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordStartTimeRef.current = Date.now();
      recordIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied or error:", err);
    }
  };

  const handleStopRecord = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive" && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingTime(0);
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    }
  };
  
  const handleCancelRecord = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive" && isRecording) {
      mediaRecorderRef.current.onstop = null; // remove logic
      mediaRecorderRef.current.stop();
      
      // Stop media tracks
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      setRecordingTime(0);
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    }
  }

  // --- Lightbox & Utility ---
  const handleDownloadImage = useCallback((base64: string) => {
    const a = document.createElement("a");
    a.href = base64; a.download = `Moments_${format(new Date(), "yyyyMMdd_HHmmss")}.jpg`; a.click();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      messages.forEach((msg) => {
        if (msg.expiresIn && now > msg.timestamp + msg.expiresIn * 1000) onClearMsg(msg.id);
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [messages, onClearMsg]);

  // Render Helpers
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const mapToDisplayItems = () => {
    type DisplayItem = { kind: "separator"; label: string; key: string } | { kind: "msg"; msg: Message; isFirst: boolean; isLast: boolean; key: string; };
    const items: DisplayItem[] = [];
    let lastDate = "";
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const dateStr = format(msg.timestamp, "yyyy-MM-dd");
        if (dateStr !== lastDate) {
            items.push({ kind: "separator", label: dateLabel(msg.timestamp), key: `sep-${dateStr}` });
            lastDate = dateStr;
        }
        const sameSenderPrev = prev && prev.sender === msg.sender && (msg.timestamp - prev.timestamp < 300000) && format(prev.timestamp, "yyyy-MM-dd") === dateStr;
        const sameSenderNext = next && next.sender === msg.sender && (next.timestamp - msg.timestamp < 300000) && format(next.timestamp, "yyyy-MM-dd") === dateStr;
        items.push({ kind: "msg", msg, isFirst: !sameSenderPrev, isLast: !sameSenderNext, key: msg.id });
    }
    return items;
  };

  const getQuotedMsg = (id: string) => messages.find(m => m.id === id);

  const displayItems = mapToDisplayItems();
  const totalParticipants = participants.length + 1;
  const isConnected = status === "connected";
  const statusText = isConnected ? `${totalParticipants} ${totalParticipants === 1 ? "device" : "devices"} connected` : status === "waiting" || status === "connecting" ? "Connecting network…" : status === "error" ? "Connection failed" : "Disconnected";

  return (
    <div className={cn("flex flex-col select-none relative transition-colors duration-500", `theme-${themeMode}`, `pattern-${bgPattern}`)} style={{ height: "100dvh" }}>
      {/* FLOATING HEADER */}
      <div className="px-4 pt-safe mt-4 z-20 shrink-0 absolute top-0 left-0 w-full pointer-events-none">
        <header className="glass-panel flex items-center justify-between px-4 py-3 rounded-[24px] pointer-events-auto">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-lg bg-gradient-warm">
                    <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                <div className="flex flex-col cursor-pointer" onClick={() => setShowNetworkHub(true)}>
                    <p className="text-[17px] font-bold tracking-wide text-white leading-tight" style={{ fontFamily: "Outfit, system-ui, sans-serif" }}>Moments</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <div className={cn("w-2 h-2 rounded-full shrink-0 shadow", isConnected ? "bg-green-400" : status === "waiting" || status === "connecting" ? "bg-yellow-400 animate-pulse" : "bg-red-400")} />
                        <span className="text-xs text-slate-300 truncate hover:text-white transition-colors">{statusText}</span>
                    </div>
                </div>
            </div>
            
            <div className="flex items-center gap-2">
                <button onClick={handleSync} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 active:bg-white/20 transition-colors cursor-pointer">
                    <RefreshCw className={cn("w-5 h-5 text-slate-200", isSyncing && "animate-spin")} />
                </button>
                <button onClick={() => setShowSettings(!showSettings)} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 active:bg-white/20 transition-colors cursor-pointer">
                    <Settings className="w-5 h-5 text-slate-200" />
                </button>
            </div>
        </header>
      </div>

      {/* ERROR PANELS */}
      <AnimatePresence>
        {sendError && (
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }} className="fixed top-[100px] left-0 right-0 z-30 px-4 pointer-events-none">
            <div className="glass-panel bg-red-900/60 p-3 rounded-2xl flex items-center justify-between pointer-events-auto shadow-[0_4px_30px_rgba(220,38,38,0.3)] border border-red-500/30">
              <span className="text-xs text-red-100 font-semibold">{sendError}</span>
              <button onClick={onDismissSendError} className="p-1 rounded-full hover:bg-red-900/80 cursor-pointer"><X className="w-4 h-4 text-red-200" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {peerError && status === "error" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-md">
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel max-w-sm w-full rounded-3xl p-8 text-center border overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-1 bg-red-500" />
              <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-5">
                <RefreshCw className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-xl font-bold text-white mb-2">Network Disconnected</p>
              <p className="text-sm text-slate-300 mb-6">Could not maintain persistent connection inside the ephemeral relay network.</p>
              <button onClick={onRetry} className="w-full py-4 rounded-xl text-[15px] font-bold text-white transition-all active:scale-[0.98] shadow-lg bg-gradient-passion cursor-pointer">
                Re-establish Link
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODALS */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowClearConfirm(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.93, opacity: 0 }} className="glass-panel relative w-full max-w-sm rounded-[24px] p-6 shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-1">Clear all messages?</h3>
              <p className="text-sm text-slate-300 mb-6 leading-relaxed">This will permanently erase the chat history on <strong className="text-white">every device</strong> in this session.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-colors bg-white/10 hover:bg-white/20 cursor-pointer">Cancel</button>
                <button onClick={() => { onClearHistory(); setShowClearConfirm(false); setShowSettings(false); }} className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-colors active:scale-[0.98] bg-red-500 hover:bg-red-600 cursor-pointer">Delete All</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPreviewImage(null)} className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 bg-black/95">
            <button className="absolute top-5 right-5 p-2.5 rounded-full z-10 bg-white/10 cursor-pointer"><X className="w-5 h-5 text-white" /></button>
            <motion.img initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} onClick={(e) => e.stopPropagation()} src={previewImage.src} alt="Preview" className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            <button onClick={(e) => { e.stopPropagation(); handleDownloadImage(previewImage.src); }} className="absolute bottom-10 px-6 py-2.5 rounded-full text-white font-medium flex items-center gap-2 transition-all hover:bg-white/10 bg-white/15 backdrop-blur-md cursor-pointer"><Download className="w-4 h-4" /> Save Photo</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSettings(false)} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: -20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: -20 }} className="absolute pt-safe top-[85px] right-4 w-72 z-50 glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col">
              
              <div className="px-5 py-3 border-b border-white/10 bg-white/5">
                <p className="text-[11px] text-purple-200/70 uppercase tracking-widest font-bold mb-2">Display</p>
                <div className="flex gap-1 mb-2">
                   {["twilight", "midnight", "dawn"].map(t => (
                      <button key={t} onClick={() => setThemeMode(t as any)} className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold capitalize transition-all border cursor-pointer", themeMode === t ? "bg-white/20 border-white/30 text-white" : "border-transparent text-white/50 hover:bg-white/10")}>{t}</button>
                   ))}
                </div>
                <div className="flex gap-1">
                   {["doodle", "dots", "none"].map(p => (
                      <button key={p} onClick={() => setBgPattern(p as any)} className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold capitalize transition-all border cursor-pointer", bgPattern === p ? "bg-white/20 border-white/30 text-white" : "border-transparent text-white/50 hover:bg-white/10")}>{p}</button>
                   ))}
                </div>
              </div>

              <div className="py-2">
                {[ 
                  { icon: notificationsEnabled ? <Bell className="w-4.5 h-4.5" /> : <BellOff className="w-4.5 h-4.5 text-slate-400" />, label: notificationsEnabled ? "Notifications Active" : "Alerts Muted", onClick: toggleNotifications, danger: false },
                  { icon: <Trash2 className="w-4.5 h-4.5" />, label: "Nuke Chat Everywhere", onClick: () => setShowClearConfirm(true), danger: true },
                  { icon: <LogOut className="w-4.5 h-4.5 text-slate-400" />, label: "Exit Moment", onClick: () => { setShowSettings(false); onLogout(); }, danger: false }
                ].map((item) => (
                  <button key={item.label} onClick={item.onClick} className={cn("cursor-pointer w-full flex items-center gap-4 px-5 py-3.5 text-[15px] font-medium text-left transition-colors", item.danger ? "text-red-400 hover:bg-red-500/10" : "text-slate-200 hover:bg-white/10")}>
                    {item.icon}<span>{item.label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* CHAT BODY */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto overscroll-contain px-4 pt-[100px] pb-[160px] space-y-1 relative z-10">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
             <div className="glass-panel p-8 rounded-[32px] flex flex-col items-center max-w-[280px] text-center border-white/5 shadow-xl">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-5 border border-white/10">
                   <Lock className="w-7 h-7 text-white/50" />
                </div>
                <p className="text-[16px] font-medium text-white/80 leading-relaxed font-display">
                    {status === "waiting" || status === "connecting" ? "Negotiating secure tunnel…" : "This is the start of your encrypted Moment."}
                </p>
             </div>
          </div>
        ) : (
          displayItems.map((item) => {
            if (item.kind === "separator") return (
                <div key={item.key} className="flex items-center justify-center py-4 my-2">
                  <span className="glass-panel px-4 py-1.5 rounded-full text-[11px] text-slate-300 font-bold tracking-widest uppercase border-white/5 shadow-sm">
                    {item.label}
                  </span>
                </div>
            );

            const { msg, isFirst, isLast } = item;
            const isMe = msg.sender === "me";
            const emojiOnly = msg.type === "text" && isEmojiOnly(msg.text);
            const br = isMe ? `20px 20px ${isLast ? "4px" : "20px"} 20px` : `20px 20px 20px ${isLast ? "4px" : "20px"}`;
            const quotedMsg = msg.replyToId ? getQuotedMsg(msg.replyToId) : null;
            const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;

            return (
              <motion.div key={item.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("flex items-end gap-2 group relative w-full", isMe ? "justify-end" : "justify-start", isFirst ? "mt-5" : "mt-0.5", hasReactions ? "mb-4" : "")}>
                 
                 <div className="relative max-w-[85vw] sm:max-w-[70%] flex flex-col">
                   {!isMe && isFirst && !emojiOnly && (
                      <span className="text-[12px] text-slate-400 font-bold ml-2 mb-1 tracking-widest uppercase font-display drop-shadow-md">
                         {profiles[msg.senderDeviceId ?? ""]?.nickname || "Partner"}
                      </span>
                   )}
                   
                   <div className={cn("relative transition-all", emojiOnly ? "" : (isMe ? "bg-gradient-warm shadow-md" : "glass-bubble-light"))}
                        style={emojiOnly ? {} : { borderRadius: br }}
                        onClick={() => setReactingToId(Reacting => Reacting === msg.id ? null : msg.id)}
                   >
                     {/* Action Context Hub (Reactions & Utilities) */}
                     {reactingToId === msg.id && (
                       <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-30 flex items-center bg-white/20 backdrop-blur-2xl border border-white/20 rounded-[20px] px-3 py-2 shadow-2xl">
                          <div className="flex items-center gap-2 border-r border-white/20 pr-3 mr-3">
                            {EMOJI_LIST.map(em => (
                               <button key={em} onClick={(e) => { e.stopPropagation(); onReaction(msg.id, em); setReactingToId(null); }} className="hover:scale-125 transition-transform text-xl leading-none active:scale-95 cursor-pointer">{em}</button>
                            ))}
                          </div>
                          <div className="flex items-center gap-3">
                             <button onClick={(e) => { e.stopPropagation(); setReplyingToId(msg.id); setReactingToId(null); }} className="text-white hover:text-orange-300 transition-colors"><CornerDownLeft className="w-4 h-4" /></button>
                             {msg.type === "text" && !emojiOnly && <button onClick={(e) => { e.stopPropagation(); handleCopy(msg.text, msg.id); setReactingToId(null); }} className="text-white hover:text-green-300 transition-colors">{copiedId === msg.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>}
                             <button onClick={(e) => { e.stopPropagation(); setReactingToId(null); }} className="text-white/60 hover:text-white ml-1"><X className="w-4 h-4" /></button>
                          </div>
                       </div>
                     )}
                     {/* Burn Timer Overlay */}
                     {msg.expiresIn && (!emojiOnly || msg.type === "image") && (
                        <div className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1.5 shadow-[0_2px_8px_rgba(239,68,68,0.6)] z-10 border border-white/20">
                          <Timer className="w-3 h-3 text-white" />
                        </div>
                     )}

                     <div className={cn(emojiOnly ? "" : "px-4 py-2.5")}>
                       {/* Quoted Message Render */}
                       {quotedMsg && !emojiOnly && (
                          <div className={cn("mb-2 pl-3 border-l-[3px] py-1 flex flex-col cursor-pointer", isMe ? "border-white/50" : "border-indigo-900/30")}>
                             <span className={cn("text-[11px] font-bold font-display uppercase tracking-wider", isMe ? "text-white/90" : "text-indigo-900/80")}>
                               {quotedMsg.sender === "me" ? "You" : (profiles[quotedMsg.senderDeviceId ?? ""]?.nickname || "Partner")}
                             </span>
                             <span className={cn("text-[13px] truncate whitespace-nowrap overflow-hidden max-w-[200px]", isMe ? "text-white/80" : "text-indigo-950/80")}>
                               {quotedMsg.type === 'image' ? '📷 Image' : quotedMsg.type === 'audio' ? '🎤 Voice Note' : quotedMsg.text}
                             </span>
                          </div>
                       )}

                       {/* Content Type Render */}
                       {msg.type === "text" && (
                         <div className={cn("flex flex-wrap items-end gap-x-3 gap-y-1", emojiOnly ? "justify-center" : "")}>
                           <p className={cn("leading-relaxed break-words flex-1 min-w-0 font-medium", emojiOnly ? "text-[64px] mx-2 leading-none drop-shadow-2xl" : "text-[16px]", isMe ? "text-white" : "text-[#1e1b4b]")}>
                             {msg.text}
                           </p>
                           {isLast && !emojiOnly && (
                              <div className={cn("flex items-center gap-1 shrink-0 self-end opacity-70", isMe ? "text-white" : "text-indigo-900")}>
                                <span className="text-[10px] font-bold pb-[1px]">{format(msg.timestamp, "HH:mm")}</span>
                                {isMe && (
                                   <div className="ml-0.5">
                                      {(msg.readBy?.length ?? 0) > 0 ? <CheckCheck className="w-[14px] h-[14px] text-white stroke-[2.5px]" /> : <Check className="w-[14px] h-[14px] stroke-[2.5px]" />}
                                   </div>
                                )}
                              </div>
                           )}
                         </div>
                       )}

                       {msg.type === "image" && (
                         <div className="relative group/dl cursor-zoom-in" onClick={() => setPreviewImage({ id: msg.id, src: msg.text })}>
                           <img src={msg.text} alt="Image" className={cn("rounded-xl max-w-full h-auto block shadow-sm border", isMe ? "border-white/10" : "border-indigo-900/10")} style={{ maxHeight: 280 }} />
                           {isLast && (
                              <div className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md">
                                <span className="text-[10px] text-white font-bold">{format(msg.timestamp, "HH:mm")}</span>
                                {isMe && ( <div className="text-white">{(msg.readBy?.length ?? 0) > 0 ? <CheckCheck className="w-3 h-3 text-blue-300 stroke-[2.5px]" /> : <Check className="w-3 h-3 stroke-[2.5px]" />}</div> )}
                              </div>
                           )}
                         </div>
                       )}

                       {msg.type === "audio" && (
                         <div className="flex items-center gap-3 w-48 sm:w-64 my-1">
                           <div className={cn("w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-inner relative pointer-events-none", isMe ? "bg-white/20" : "bg-indigo-900/10")}>
                             <Play className={cn("w-5 h-5 translate-x-0.5 relative z-10", isMe ? "text-white" : "text-indigo-900")} fill="currentColor" />
                           </div>
                           <div className="flex-1 flex flex-col relative h-full justify-center">
                              {/* Native Audio Player overlay */}
                              <audio src={msg.text} controls className="opacity-0 absolute w-full h-full left-0 top-0 cursor-pointer z-10" />
                              <div className="h-1.5 w-full bg-black/10 rounded-full overflow-hidden mt-1 pointer-events-none">
                                 <div className={cn("h-full w-2", isMe ? "bg-white" : "bg-indigo-500")} /> 
                              </div>
                              <div className={cn("text-[11px] font-bold mt-1.5 flex justify-between pointer-events-none", isMe ? "text-white/80" : "text-indigo-900/70")}>
                                 <span>Voice Note</span>
                                 {isLast && (
                                    <div className="flex items-center gap-1">
                                      <span className="opacity-80">{msg.audioDuration && `${formatTime(msg.audioDuration)} • `}{format(msg.timestamp, "HH:mm")}</span>
                                      {isMe && ( (msg.readBy?.length ?? 0) > 0 ? <CheckCheck className="w-3.5 h-3.5 text-white stroke-[2.5px]" /> : <Check className="w-3.5 h-3.5 stroke-[2.5px]" /> )}
                                    </div>
                                 )}
                              </div>
                           </div>
                         </div>
                       )}
                     </div>

                     {/* Inline Reactions Display */}
                     {hasReactions && (
                       <div className={cn("absolute -bottom-3 flex gap-1 z-10", isMe ? "left-2" : "right-2")}>
                          {Object.entries(msg.reactions!).map(([emoji, users]) => (
                             <motion.div initial={{scale:0}} animate={{scale:1}} key={emoji} className={cn("px-2 py-0.5 rounded-full text-[13px] shadow-sm border border-white/10 flex items-center gap-1", isMe ? "glass-bubble-light" : "glass-panel")}>
                                <span>{emoji}</span>
                                {users.length > 1 && <span className={cn("text-[10px] font-bold", isMe ? "text-indigo-900/80" : "text-white/80")}>{users.length}</span>}
                             </motion.div>
                          ))}
                       </div>
                     )}
                   </div>
                 </div>
              </motion.div>
            );
          })
        )}
        
        {typingUsers.length > 0 && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex justify-start mt-4 px-1">
            <div className="px-4 py-3 rounded-[20px] rounded-tl-sm flex items-center gap-1.5 glass-bubble-light shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-900/40 animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-900/40 animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-900/40 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} className="h-6" />
      </div>

      {/* FLOATING ACTION BOTTOM TRAY */}
      <div className="absolute bottom-0 left-0 w-full px-3 pb-safe mb-4 pointer-events-none z-30 flex flex-col gap-2">
        {/* Quoted Message Preview Overlay */}
        <AnimatePresence>
          {replyingToId && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="w-full max-w-4xl mx-auto pointer-events-auto">
               <div className="glass-panel mx-2 rounded-[20px] p-3 pl-4 flex items-start gap-3 border-l-[3px] border-l-orange-400 relative overflow-hidden shadow-2xl">
                  <div className="absolute inset-0 bg-white/5" />
                  <div className="flex-1 min-w-0 pr-6 relative z-10">
                     <p className="text-[11px] font-bold text-orange-400 font-display uppercase tracking-widest mb-1">Replying To {getQuotedMsg(replyingToId)?.sender === 'partner' && profiles[getQuotedMsg(replyingToId)?.senderDeviceId ?? ""]?.nickname}</p>
                     <p className="text-[14px] text-white/90 truncate font-medium">
                        {getQuotedMsg(replyingToId)?.type === 'image' ? '📷 Image' : getQuotedMsg(replyingToId)?.type === 'audio' ? '🎤 Voice Note' : getQuotedMsg(replyingToId)?.text}
                     </p>
                  </div>
                  <button onClick={() => setReplyingToId(null)} className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 absolute right-3 top-3 text-white z-10 cursor-pointer"><X className="w-4 h-4" /></button>
               </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="w-full max-w-4xl mx-auto flex items-end gap-2 px-2 pointer-events-auto relative">
           {/* Primary Input Pill */}
           <div className={cn("flex-1 glass-panel rounded-[24px] flex items-end p-1.5 transition-all shadow-xl", replyingToId && "rounded-tr-[8px] rounded-tl-[8px]")}>
              
              {/* Attachment Button */}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 hover:bg-white/10 text-white/70 transition-colors mb-0.5 cursor-pointer">
                <ImageIcon className="w-5 h-5" />
              </button>
              <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />

              {/* Text Area vs Recording View */}
              {isRecording ? (
                <div className="flex-1 flex items-center justify-between px-3 h-[42px] mb-0.5 bg-red-500/10 rounded-full border border-red-500/30">
                   <div className="flex items-center gap-3">
                     <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                     <span className="text-red-400 font-medium font-mono tracking-widest text-sm">{formatTime(recordingTime)}</span>
                   </div>
                   <button type="button" onClick={handleCancelRecord} className="text-white/50 text-xs font-bold uppercase tracking-wider hover:text-white px-3 cursor-pointer">Cancel</button>
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={status === "connected" ? "Message..." : "Connecting..."}
                  disabled={status !== "connected"}
                  rows={1}
                  className="flex-1 bg-transparent border-none outline-none resize-none text-[16px] font-medium text-white placeholder-white/40 leading-[1.4] max-h-[120px] px-2 py-2.5 disabled:opacity-50"
                  style={{ fontFamily: 'Inter' }}
                />
              )}

              {/* Action Tools (Timer) */}
              {(!isRecording) && (
                 <div className="flex items-center gap-1 shrink-0 ml-1 mb-0.5">
                    <button type="button" onClick={() => setBurnIdx((burnIdx + 1) % BURN_OPTIONS.length)} className={cn("px-2.5 h-10 rounded-full flex items-center gap-1.5 transition-all text-[12px] font-bold cursor-pointer", BURN_OPTIONS[burnIdx] ? "bg-red-500/20 text-red-100 border border-red-500/30" : "text-white/50 hover:bg-white/10 hover:text-white/80")}>
                       <Timer className="w-4 h-4" strokeWidth={2.5} />
                       {BURN_OPTIONS[burnIdx] && BURN_LABELS[BURN_OPTIONS[burnIdx]!]}
                    </button>
                 </div>
              )}
           </div>

           {/* Outside Action Button */}
           <motion.button
              type="button"
              disabled={status !== "connected"}
              whileTap={{ scale: 0.9 }}
              onClick={input.trim() ? handleSend : undefined}
              onPointerDown={!input.trim() ? handleStartRecord : undefined}
              onPointerUp={!input.trim() ? handleStopRecord : undefined}
              onPointerLeave={!input.trim() ? handleCancelRecord : undefined}
              className={cn("w-[52px] h-[52px] rounded-full flex items-center justify-center shrink-0 mb-0 shadow-lg text-white transition-all transform-gpu border border-white/5 cursor-pointer", (input.trim() || isRecording) ? "bg-gradient-passion shadow-[0_4px_24px_rgba(244,63,94,0.4)] scale-100" : "glass-panel scale-[0.98] opacity-90")}
           >
              {input.trim() ? <Send className="w-5 h-5 ml-0.5" strokeWidth={2.5} /> : isRecording ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" strokeWidth={2.5} />}
           </motion.button>
        </div>
      </div>
      
      <AnimatePresence>
         {showScrollDown && (
            <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} onClick={() => scrollToBottom()} className="absolute bottom-[100px] right-6 z-20 w-11 h-11 rounded-full flex items-center justify-center shadow-xl glass-panel text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer">
               <ChevronDown className="w-6 h-6" strokeWidth={2.5} />
            </motion.button>
         )}
      </AnimatePresence>
    </div>
  );
}
