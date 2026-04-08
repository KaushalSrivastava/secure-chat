import React, { useState, useRef, useEffect } from "react";
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
  LogOut,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { Message } from "../hooks/useChat";
import { ConnectionStatus, PeerRole } from "../hooks/usePeer";
import { cn } from "../lib/utils";

interface ChatProps {
  messages: Message[];
  onSendMessage: (text: string, type: "text" | "image") => void;
  status: ConnectionStatus;
  onClearHistory: () => void;
  sendError: string | null;
  onDismissSendError: () => void;
  onLogout: () => void;
  role: PeerRole;
  peerError: string | null;
  onRetry: () => void;
}

export function Chat({
  messages,
  onSendMessage,
  status,
  onClearHistory,
  sendError,
  onDismissSendError,
  onLogout,
  role,
  peerError,
  onRetry,
}: ChatProps) {
  // Peer A = indigo/violet palette, Peer B = emerald/teal palette
  // "me" side always matches my role, "partner" matches the other role
  const myColor   = role === "B" ? "emerald" : "indigo"; // default to indigo before role resolves
  const yourColor = role === "B" ? "indigo"  : "emerald";

  const bubbleClass = (sender: "me" | "partner") => {
    const color = sender === "me" ? myColor : yourColor;
    if (sender === "me") {
      return color === "indigo"
        ? "bg-indigo-600 text-white rounded-br-sm"
        : "bg-emerald-600 text-white rounded-br-sm";
    }
    // partner bubbles: muted tint so they're still readable
    return color === "indigo"
      ? "bg-indigo-950/80 text-indigo-100 border border-indigo-800/40 rounded-bl-sm"
      : "bg-emerald-950/80 text-emerald-100 border border-emerald-800/40 rounded-bl-sm";
  };
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    try {
      if ("Notification" in window) {
        setNotificationsEnabled(Notification.permission === "granted");
      }
    } catch (e) {
      console.error("Error checking notification permission", e);
    }
  }, []);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSendMessage(input.trim(), "text");
      setInput("");
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      onSendMessage(base64, "image");
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const toggleNotifications = async () => {
    if (!("Notification" in window)) {
      alert("This browser does not support desktop notification");
      return;
    }

    try {
      if (Notification.permission === "granted") {
        // Can't programmatically revoke, just disable in our state
        setNotificationsEnabled(false);
      } else if (Notification.permission !== "denied") {
        const permission = await Notification.requestPermission();
        setNotificationsEnabled(permission === "granted");
      }
    } catch (e) {
      console.error("Error requesting notification permission", e);
    }
  };

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#050505] text-white relative overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-4 bg-zinc-900/70 backdrop-blur-xl border-b border-zinc-800/50 sticky top-0 z-20">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div
              className={cn(
                "w-3 h-3 rounded-full",
                status === "connected"
                  ? "bg-green-500"
                  : status === "connecting" || status === "waiting"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-red-500",
              )}
            />
            {status === "connected" && (
              <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-50" />
            )}
          </div>
          <span className="font-medium tracking-wide">
            {status === "connected"
              ? "Connected"
              : status === "connecting" || status === "waiting"
                ? "Waiting for partner..."
                : "Disconnected"}
          </span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
        >
          <Settings className="w-5 h-5 text-zinc-400" />
        </button>
      </header>

      {/* Connection Error Overlay */}
      <AnimatePresence>
        {peerError && status === "error" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-12 h-12 rounded-full bg-red-950/60 border border-red-800/50 flex items-center justify-center mx-auto mb-4">
                <RefreshCw className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-medium text-white mb-2">Connection failed</h3>
              <p className="text-zinc-400 text-sm mb-6">
                Could not open a relay channel. This usually means the TURN server is temporarily unreachable.
              </p>
              <button
                onClick={onRetry}
                className="w-full px-4 py-3 rounded-xl bg-white text-black font-medium hover:bg-zinc-200 active:scale-[0.98] transition-all"
              >
                Retry connection
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Send Error Banner */}
      <AnimatePresence>
        {sendError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-between px-4 py-2.5 bg-red-950/70 border-b border-red-800/50 text-red-300 text-sm"
          >
            <span>{sendError}</span>
            <button onClick={onDismissSendError} className="ml-3 p-1 hover:bg-red-900/50 rounded-full transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="fixed inset-0 z-20 bg-black/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.2 }}
              className="absolute top-20 right-4 w-64 bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl z-30 overflow-hidden"
            >
              <div className="p-4 border-b border-zinc-800/50 flex justify-between items-center">
                <h3 className="font-medium text-zinc-200">Settings</h3>
                <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-zinc-800 rounded-full transition-colors">
                  <X className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
              <div className="p-2 space-y-1">
                <button
                  onClick={toggleNotifications}
                  className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-zinc-800/50 rounded-xl transition-colors text-left"
                >
                  {notificationsEnabled ? (
                    <Bell className="w-4 h-4 text-zinc-300" />
                  ) : (
                    <BellOff className="w-4 h-4 text-zinc-500" />
                  )}
                  <span className="text-sm text-zinc-300">
                    {notificationsEnabled ? "Notifications On" : "Notifications Off"}
                  </span>
                </button>
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-red-500/10 text-red-400 rounded-xl transition-colors text-left"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="text-sm">Clear History</span>
                </button>
                <button
                  onClick={() => { setShowSettings(false); onLogout(); }}
                  className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-zinc-800/50 rounded-xl transition-colors text-left"
                >
                  <LogOut className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm text-zinc-300">Change session</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Clear Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowClearConfirm(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl z-10 relative"
            >
              <h3 className="text-xl font-medium mb-2">Clear History?</h3>
              <p className="text-zinc-400 text-sm mb-6">
                This will permanently delete all messages for both you and your partner. This action cannot be undone.
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onClearHistory();
                    setShowClearConfirm(false);
                    setShowSettings(false);
                  }}
                  className="flex-1 px-4 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
                >
                  Clear All
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Image Lightbox */}
      <AnimatePresence>
        {previewImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPreviewImage(null)}
              className="absolute top-6 right-6 p-3 bg-zinc-900/50 hover:bg-zinc-800 rounded-full text-white transition-colors z-10"
            >
              <X className="w-6 h-6" />
            </motion.button>
            <motion.img
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-full object-contain p-4"
            />
          </div>
        )}
      </AnimatePresence>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scroll-smooth">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-4">
            <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center">
              <Lock className="w-6 h-6 opacity-50" />
            </div>
            <p className="text-sm">Messages are end-to-end encrypted.</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMe = msg.sender === "me";
            const showTime =
              i === 0 ||
              msg.timestamp - messages[i - 1].timestamp > 5 * 60 * 1000;

            return (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                key={msg.id}
                className={cn(
                  "flex flex-col group",
                  isMe ? "items-end" : "items-start",
                )}
              >
                {showTime && (
                  <span className="text-[10px] text-zinc-500 mb-2 px-2 uppercase tracking-wider font-medium">
                    {format(msg.timestamp, "HH:mm")}
                  </span>
                )}
                <div className={cn("flex items-end space-x-2", isMe && "flex-row-reverse space-x-reverse")}>
                  <div
                    className={cn(
                      "max-w-[85vw] sm:max-w-[75%] rounded-2xl px-4 py-3 relative shadow-sm",
                      bubbleClass(msg.sender),
                    )}
                  >
                    {msg.type === "text" ? (
                      <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                        {msg.text}
                      </p>
                    ) : (
                      <img
                        src={msg.text}
                        alt="Shared"
                        onClick={() => setPreviewImage(msg.text)}
                        className="rounded-lg max-w-full h-auto cursor-zoom-in hover:opacity-90 transition-opacity"
                      />
                    )}
                  </div>
                  
                  {/* Copy Button for Text Messages */}
                  {msg.type === "text" && (
                    <button
                      onClick={() => handleCopy(msg.text, msg.id)}
                      className={cn(
                        "p-2 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100",
                        copiedId === msg.id && "text-green-400 border-green-900/50 bg-green-900/20"
                      )}
                      aria-label="Copy message"
                    >
                      {copiedId === msg.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })
        )}
        <div ref={messagesEndRef} className="h-2" />
      </div>

      {/* Input Area */}
      <div className="p-4 sm:p-6 bg-[#050505] border-t border-zinc-900/80 pb-safe">
        <form onSubmit={handleSend} className="flex items-end space-x-3 max-w-4xl mx-auto">
          <div className="flex-1 bg-zinc-900/80 rounded-3xl border border-zinc-800/80 flex items-center px-2 py-1.5 focus-within:border-zinc-600 focus-within:ring-1 focus-within:ring-zinc-600 transition-all shadow-sm">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
            />

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message..."
              className="flex-1 bg-transparent border-none focus:ring-0 px-3 py-2.5 text-[15px] text-white placeholder-zinc-500"
            />
          </div>

          <button
            type="submit"
            disabled={!input.trim() || status !== "connected"}
            className={cn(
              "p-4 rounded-full flex items-center justify-center transition-all shadow-sm",
              input.trim() && status === "connected"
                ? "bg-white text-black hover:bg-zinc-200 active:scale-95"
                : "bg-zinc-900 text-zinc-600",
            )}
          >
            <Send className="w-5 h-5 ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
