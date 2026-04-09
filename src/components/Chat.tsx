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
  Flame,
  Timer,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { Message } from "../hooks/useChat";
import { ConnectionStatus } from "../hooks/useNostr";
import { cn } from "../lib/utils";

const DEVICE_COLORS = [
  { bg: "#2b5bdb", tail: "#2b5bdb" },
  { bg: "#1a7a5e", tail: "#1a7a5e" },
  { bg: "#7c3aed", tail: "#7c3aed" },
  { bg: "#c05621", tail: "#c05621" },
  { bg: "#b91c55", tail: "#b91c55" },
  { bg: "#0e7490", tail: "#0e7490" },
];
function deviceColorIdx(id = "") {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % DEVICE_COLORS.length;
}

function dateLabel(ts: number) {
  const d = new Date(ts);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMMM d, yyyy");
}

const isEmojiOnly = (text: string) => {
  // Matches strings that contain ONLY emojis and spaces
  const emojiRegex =
    /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})(\s*(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic}))*$/u;
  return text.trim().length <= 15 && emojiRegex.test(text.trim());
};

const BURN_OPTIONS = [null, 15, 60, 3600]; // Off, 15s, 1m, 1h
const BURN_LABELS: Record<string, string> = {
  "15": "15s",
  "60": "1m",
  "3600": "1h",
};

interface ChatProps {
  messages: Message[];
  myDeviceId: string;
  participants: string[];
  typingUsers: string[];
  status: ConnectionStatus;
  sendError: string | null;
  peerError: string | null;

  onSendMessage: (
    text: string,
    type: "text" | "image",
    opts?: { viewOnce?: boolean; expiresIn?: number },
  ) => void;
  onClearHistory: () => void;
  onClearMsg: (id: string) => void;
  onMarkViewed: (id: string) => void;
  onSyncReq: () => void;
  onTyping: (isTyping: boolean) => void;
  onDismissSendError: () => void;
  onLogout: () => void;
  onRetry: () => void;
}

export function Chat({
  messages,
  myDeviceId,
  participants,
  typingUsers,
  status,
  sendError,
  peerError,
  onSendMessage,
  onClearHistory,
  onClearMsg,
  onMarkViewed,
  onSyncReq,
  onTyping,
  onDismissSendError,
  onLogout,
  onRetry,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    id: string;
    src: string;
    viewOnce: boolean;
  } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [burnIdx, setBurnIdx] = useState(0);
  const [viewOnceMode, setViewOnceMode] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll Down
  const scrollToBottom = useCallback(
    (smooth = true) =>
      messagesEndRef.current?.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
      }),
    [],
  );
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Show "scroll down" arrow
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const onScroll = () =>
      setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Sync button rotation
  const handleSync = () => {
    setIsSyncing(true);
    onSyncReq();
    setTimeout(() => setIsSyncing(false), 1000);
  };

  // Push notification permission check
  useEffect(() => {
    try {
      if ("Notification" in window)
        setNotificationsEnabled(Notification.permission === "granted");
    } catch {
      /* ignore */
    }
  }, []);

  // Textarea resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 108) + "px";
  }, [input]);

  // Typings
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    onTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), 2000);
  };

  // Sends
  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && status === "connected") {
      onSendMessage(input.trim(), "text", {
        expiresIn: BURN_OPTIONS[burnIdx] || undefined,
      });
      setInput("");
      onTyping(false);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as unknown as React.FormEvent);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onSendMessage(ev.target?.result as string, "image", {
        viewOnce: viewOnceMode,
        expiresIn: BURN_OPTIONS[burnIdx] || undefined,
      });
      setViewOnceMode(false); // reset toggle
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Self Destruct Sweeper
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      messages.forEach((msg) => {
        if (msg.expiresIn) {
          if (now > msg.timestamp + msg.expiresIn * 1000) {
            onClearMsg(msg.id);
          }
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [messages, onClearMsg]);

  // UI Helpers
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

  const closeLightbox = () => {
    if (previewImage?.viewOnce) onClearMsg(previewImage.id);
    setPreviewImage(null);
  };

  // Display List
  type DisplayItem =
    | { kind: "separator"; label: string; key: string }
    | {
        kind: "msg";
        msg: Message;
        isFirst: boolean;
        isLast: boolean;
        key: string;
      };
  const displayItems: DisplayItem[] = [];
  let lastDate = "";
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const dateStr = format(msg.timestamp, "yyyy-MM-dd");
    if (dateStr !== lastDate) {
      displayItems.push({
        kind: "separator",
        label: dateLabel(msg.timestamp),
        key: `sep-${dateStr}`,
      });
      lastDate = dateStr;
    }
    const sameSenderPrev =
      prev &&
      prev.sender === msg.sender &&
      msg.timestamp - prev.timestamp < 300000 &&
      format(prev.timestamp, "yyyy-MM-dd") === dateStr;
    const sameSenderNext =
      next &&
      next.sender === msg.sender &&
      next.timestamp - msg.timestamp < 300000 &&
      format(next.timestamp, "yyyy-MM-dd") === dateStr;
    displayItems.push({
      kind: "msg",
      msg,
      isFirst: !sameSenderPrev,
      isLast: !sameSenderNext,
      key: msg.id,
    });
  }

  const totalParticipants = participants.length + 1;
  const isConnected = status === "connected";
  const statusText = isConnected
    ? `${totalParticipants} ${totalParticipants === 1 ? "device" : "devices"} connected`
    : status === "waiting" || status === "connecting"
      ? "Connecting to relays…"
      : status === "error"
        ? "Connection failed"
        : "Disconnected";

  return (
    <div
      className="flex flex-col select-none"
      style={{ height: "100dvh", background: "#0e1621" }}
    >
      <header
        className="flex items-center gap-3 px-4 py-3 pt-safe z-20 shrink-0"
        style={{
          background: "#17212b",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
        }}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)",
            boxShadow: "0 0 16px rgba(43,91,219,0.4)",
          }}
        >
          <Lock className="w-4.5 h-4.5 text-white" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-white leading-tight">
            SecureChat
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                isConnected
                  ? "bg-green-400"
                  : status === "waiting" || status === "connecting"
                    ? "bg-yellow-400 animate-pulse"
                    : "bg-red-400",
              )}
            />
            <span className="text-xs text-slate-400 truncate">
              {statusText}
            </span>
            {isConnected && totalParticipants > 1 && (
              <>
                <span className="text-slate-600 text-xs">·</span>
                <Users className="w-3 h-3 text-slate-500 shrink-0" />
              </>
            )}
          </div>
        </div>
        <button
          onClick={handleSync}
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/8 active:bg-white/12 transition-colors shrink-0"
        >
          <RefreshCw
            className={cn(
              "w-4.5 h-4.5 text-slate-400",
              isSyncing && "animate-spin text-white",
            )}
          />
        </button>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/8 active:bg-white/12 transition-colors shrink-0"
        >
          <Settings className="w-5 h-5 text-slate-400" />
        </button>
      </header>

      <AnimatePresence>
        {sendError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden shrink-0"
            style={{
              background: "rgba(185,28,48,0.2)",
              borderBottom: "1px solid rgba(185,28,48,0.3)",
            }}
          >
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs text-red-300">{sendError}</span>
              <button
                onClick={onDismissSendError}
                className="ml-3 p-1 rounded-full hover:bg-red-900/40"
              >
                <X className="w-3.5 h-3.5 text-red-400" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {peerError && status === "error" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{
              background: "rgba(0,0,0,0.7)",
              backdropFilter: "blur(8px)",
            }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="max-w-sm w-full rounded-2xl p-6 text-center"
              style={{
                background: "#1f2d3d",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(185,28,48,0.2)" }}
              >
                <RefreshCw className="w-5 h-5 text-red-400" />
              </div>
              <p className="text-base font-semibold text-white mb-1">
                Relay unreachable
              </p>
              <p className="text-sm text-slate-400 mb-5">
                Could not connect to any relay server. Check your network.
              </p>
              <button
                onClick={onRetry}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98]"
                style={{
                  background:
                    "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)",
                }}
              >
                Retry Connection
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="fixed inset-0 z-30"
              style={{ background: "rgba(0,0,0,0.4)" }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -8 }}
              transition={{ duration: 0.18 }}
              className="absolute top-[68px] right-3 w-60 z-40 rounded-2xl overflow-hidden shadow-2xl"
              style={{
                background: "#1f2d3d",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className="px-4 py-3 border-b"
                style={{ borderColor: "rgba(255,255,255,0.06)" }}
              >
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Session
                </p>
              </div>
              {[
                {
                  icon: notificationsEnabled ? (
                    <Bell className="w-4 h-4" />
                  ) : (
                    <BellOff className="w-4 h-4 text-slate-500" />
                  ),
                  label: notificationsEnabled
                    ? "Notifications On"
                    : "Notifications Off",
                  onClick: toggleNotifications,
                  danger: false,
                },
                {
                  icon: <Trash2 className="w-4 h-4" />,
                  label: "Clear Chat (all devices)",
                  onClick: () => setShowClearConfirm(true),
                  danger: true,
                },
                {
                  icon: <LogOut className="w-4 h-4 text-slate-400" />,
                  label: "Leave Session",
                  onClick: () => {
                    setShowSettings(false);
                    onLogout();
                  },
                  danger: false,
                },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3.5 text-sm text-left transition-colors min-h-[44px]",
                    item.danger
                      ? "text-red-400 hover:bg-red-400/10"
                      : "text-slate-200 hover:bg-white/5",
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowClearConfirm(false)}
              className="absolute inset-0"
              style={{
                background: "rgba(0,0,0,0.6)",
                backdropFilter: "blur(6px)",
              }}
            />
            <motion.div
              initial={{ scale: 0.93, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.93, opacity: 0 }}
              className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl"
              style={{
                background: "#1f2d3d",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <h3 className="text-base font-semibold text-white mb-1">
                Clear all messages?
              </h3>
              <p className="text-sm text-slate-400 mb-5 leading-relaxed">
                This will erase chat history on{" "}
                <strong className="text-white">every device</strong> in this
                session. Cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-3 rounded-xl text-sm font-medium text-white transition-colors"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onClearHistory();
                    setShowClearConfirm(false);
                    setShowSettings(false);
                  }}
                  className="flex-1 py-3 rounded-xl text-sm font-medium text-white transition-colors active:scale-[0.98]"
                  style={{ background: "#dc2626" }}
                >
                  Delete All
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeLightbox}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.92)" }}
          >
            <button
              className="absolute top-5 right-5 p-2.5 rounded-full z-10"
              style={{ background: "rgba(255,255,255,0.1)" }}
            >
              <X className="w-5 h-5 text-white" />
            </button>
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              src={previewImage.src}
              alt="Preview"
              className="max-w-full max-h-full object-contain rounded-lg"
            />
            {previewImage.viewOnce && (
              <p className="text-white font-medium mt-6 bg-red-600/80 px-4 py-2 rounded-full flex items-center gap-2">
                <Flame className="w-4 h-4" /> This photo will self-destruct when
                closed.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={scrollAreaRef}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-1"
        style={{ background: "#0e1621" }}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-600">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: "#17212b" }}
            >
              <Lock className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-center">
              {status === "waiting" || status === "connecting"
                ? "Connecting to relay network…"
                : "Start the conversation.\nMessages are end-to-end encrypted."}
            </p>
          </div>
        ) : (
          displayItems.map((item) => {
            if (item.kind === "separator")
              return (
                <div key={item.key} className="flex items-center gap-3 py-3">
                  <div
                    className="flex-1 h-px"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                  />
                  <span className="text-[11px] text-slate-600 font-medium px-2">
                    {item.label}
                  </span>
                  <div
                    className="flex-1 h-px"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                  />
                </div>
              );

            const { msg, isFirst, isLast } = item;
            const isMe = msg.sender === "me";
            const devColor =
              DEVICE_COLORS[
                deviceColorIdx(isMe ? myDeviceId : (msg.senderDeviceId ?? ""))
              ];
            const br = isMe
              ? `16px 16px ${isLast ? "4px" : "16px"} 16px`
              : `16px 16px 16px ${isLast ? "4px" : "16px"}`;

            const emojiOnly = msg.type === "text" && isEmojiOnly(msg.text);

            return (
              <motion.div
                key={item.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "flex items-end gap-2 group",
                  isMe ? "justify-end" : "justify-start",
                  isFirst ? "mt-3" : "mt-0.5",
                )}
              >
                {!isMe && msg.type === "text" && !emojiOnly && (
                  <button
                    onClick={() => handleCopy(msg.text, msg.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity mb-1 p-1.5 rounded-full"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                  >
                    {copiedId === msg.id ? (
                      <Check className="w-3 h-3 text-green-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-slate-500" />
                    )}
                  </button>
                )}

                <div
                  className={cn(
                    "relative max-w-[75vw] sm:max-w-[62%]",
                    emojiOnly ? "" : "",
                  )}
                >
                  <div
                    className={cn(
                      "px-3.5 py-2.5",
                      emojiOnly ? "" : "select-text shadow-sm",
                    )}
                    style={
                      emojiOnly
                        ? { background: "transparent" }
                        : {
                            background: isMe ? devColor.bg : "#1f2d3d",
                            borderRadius: br,
                          }
                    }
                  >
                    {/* Expiration warning icon */}
                    {msg.expiresIn && !emojiOnly && (
                      <div className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1 shadow-md z-10">
                        <Timer className="w-3 h-3" />
                      </div>
                    )}

                    {msg.type === "text" ? (
                      <div
                        className={cn(
                          "flex items-end gap-3 flex-wrap",
                          emojiOnly ? "justify-center" : "",
                        )}
                      >
                        <p
                          className={cn(
                            "leading-[1.45] text-white whitespace-pre-wrap break-words flex-1 min-w-0",
                            emojiOnly ? "text-6xl mx-2 my-1" : "text-[15px]",
                          )}
                        >
                          {msg.text}
                        </p>
                        {isLast && !emojiOnly && (
                          <div
                            className="flex items-center gap-1 shrink-0 self-end"
                            style={{
                              color: isMe
                                ? "rgba(255,255,255,0.6)"
                                : "rgba(148,163,184,0.6)",
                              lineHeight: 1,
                            }}
                          >
                            <span className="text-[10px]">
                              {format(msg.timestamp, "HH:mm")}
                            </span>
                            {isMe && (
                              <div className="ml-0.5">
                                {(msg.readBy?.length ?? 0) > 0 ? (
                                  <CheckCheck className="w-[14px] h-[14px] text-blue-200" />
                                ) : (
                                  <Check className="w-[14px] h-[14px]" />
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="relative">
                        {msg.viewOnce ? (
                          <button
                            onClick={() =>
                              setPreviewImage({
                                id: msg.id,
                                src: msg.text,
                                viewOnce: true,
                              })
                            }
                            className="w-48 h-48 sm:w-64 sm:h-64 rounded-xl flex flex-col items-center justify-center gap-3 bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 transition-colors"
                          >
                            <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center">
                              <Flame className="w-6 h-6" />
                            </div>
                            <span className="text-white text-sm font-semibold">
                              View Photo
                            </span>
                          </button>
                        ) : (
                          <img
                            src={msg.text}
                            alt="Image"
                            onClick={() =>
                              setPreviewImage({
                                id: msg.id,
                                src: msg.text,
                                viewOnce: false,
                              })
                            }
                            className="rounded-xl max-w-full h-auto cursor-zoom-in block border border-transparent"
                            style={{ maxHeight: 280 }}
                          />
                        )}
                        {isLast && (
                          <div
                            className="absolute bottom-1.5 right-2 flex items-center gap-1.5 px-1 rounded"
                            style={{ background: "rgba(0,0,0,0.3)" }}
                          >
                            <span className="text-[10px] text-white/90">
                              {format(msg.timestamp, "HH:mm")}
                            </span>
                            {isMe && (
                              <div className="flex items-center text-white/90">
                                {(msg.readBy?.length ?? 0) > 0 ? (
                                  <CheckCheck className="w-3 h-3 text-blue-300" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {isLast && !emojiOnly && (
                    <div
                      className="absolute bottom-0"
                      style={
                        isMe
                          ? {
                              right: -6,
                              width: 0,
                              height: 0,
                              borderStyle: "solid",
                              borderWidth: "0 0 10px 10px",
                              borderColor: `transparent transparent ${devColor.tail} transparent`,
                            }
                          : {
                              left: -6,
                              width: 0,
                              height: 0,
                              borderStyle: "solid",
                              borderWidth: "0 10px 10px 0",
                              borderColor:
                                "transparent #1f2d3d transparent transparent",
                            }
                      }
                    />
                  )}
                </div>

                {isMe && msg.type === "text" && !emojiOnly && (
                  <button
                    onClick={() => handleCopy(msg.text, msg.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity mb-1 p-1.5 rounded-full"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                  >
                    {copiedId === msg.id ? (
                      <Check className="w-3 h-3 text-green-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-slate-500" />
                    )}
                  </button>
                )}
              </motion.div>
            );
          })
        )}

        {/* Typing Bubble Indicator */}
        {typingUsers.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex justify-start mt-2 px-1"
          >
            <div
              className="px-3 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1"
              style={{ background: "#1f2d3d" }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <div
                className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <div
                className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} className="h-2" />
      </div>

      <AnimatePresence>
        {showScrollDown && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => scrollToBottom()}
            className="absolute bottom-24 right-4 z-20 w-10 h-10 rounded-full flex items-center justify-center shadow-lg"
            style={{
              background: "#17212b",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <ChevronDown className="w-5 h-5 text-slate-300" />
          </motion.button>
        )}
      </AnimatePresence>

      <div
        className="shrink-0 px-3 py-3 pb-safe"
        style={{
          background: "#17212b",
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {/* Quick Toolbar */}
        <div className="flex items-center justify-between px-2 mb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBurnIdx((burnIdx + 1) % BURN_OPTIONS.length)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-full flex items-center gap-1.5 transition-colors border",
                BURN_OPTIONS[burnIdx]
                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                  : "border-white/10 text-slate-400 hover:bg-white/5",
              )}
            >
              <Timer className="w-3.5 h-3.5" />
              {BURN_OPTIONS[burnIdx]
                ? `Self-Destruct: ${BURN_LABELS[BURN_OPTIONS[burnIdx]!]}`
                : "Self-Destruct: Off"}
            </button>
            <button
              type="button"
              onClick={() => setViewOnceMode(!viewOnceMode)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-full flex items-center gap-1.5 transition-colors border",
                viewOnceMode
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-white/10 text-slate-400 hover:bg-white/5",
              )}
            >
              <Flame className="w-3.5 h-3.5" />
              {viewOnceMode ? "View Once Photo On" : "View Once Photo Off"}
            </button>
          </div>
        </div>

        <form
          onSubmit={handleSend}
          className="flex items-end gap-2 max-w-4xl mx-auto"
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-colors"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            <ImageIcon className="w-4.5 h-4.5 text-slate-400" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            className="hidden"
          />

          <div
            className="flex-1 flex items-end rounded-2xl px-4 py-2.5 transition-all"
            style={{
              background: "#1f2d3d",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                status === "connected" ? "Write a message…" : "Connecting…"
              }
              disabled={status !== "connected"}
              rows={1}
              className="flex-1 bg-transparent border-none outline-none resize-none text-[15px] text-white placeholder-slate-600 leading-[1.45] max-h-[108px] disabled:opacity-40"
            />
          </div>

          <motion.button
            type="submit"
            disabled={!input.trim() || status !== "connected"}
            whileTap={{ scale: 0.92 }}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-all"
            style={{
              background:
                input.trim() && status === "connected"
                  ? "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)"
                  : "rgba(255,255,255,0.06)",
              boxShadow:
                input.trim() && status === "connected"
                  ? "0 0 16px rgba(59,130,246,0.35)"
                  : "none",
            }}
          >
            <Send
              className={cn(
                "w-4.5 h-4.5 ml-0.5",
                input.trim() && status === "connected"
                  ? "text-white"
                  : "text-slate-600",
              )}
            />
          </motion.button>
        </form>
      </div>
    </div>
  );
}
