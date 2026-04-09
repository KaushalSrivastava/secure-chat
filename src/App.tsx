import React, { useState, useEffect, useCallback } from "react";
import { Login } from "./components/Login";
import { Chat } from "./components/Chat";
import { useNostr, getDeviceId } from "./hooks/useNostr";
import { useChat, Message } from "./hooks/useChat";
import { AnimatePresence, motion } from "motion/react";

const SESSION_KEY = "sc_session_key";
const MY_DEVICE_ID = getDeviceId();

export default function App() {
  const [password, setPassword] = useState<string | null>(
    () => localStorage.getItem(SESSION_KEY),
  );
  const [sendError, setSendError] = useState<string | null>(null);

  const {
    status,
    error: peerError,
    role,
    participants,
    sendData,
    broadcastClear,
    setOnDataReceived,
    setOnClear,
  } = useNostr(password);

  const { messages, addMessage, clearHistory, isReady } = useChat(password);

  // When a remote user clears the chat — clear ours too
  useEffect(() => {
    setOnClear(() => {
      clearHistory();
    });
  }, [setOnClear, clearHistory]);

  // Handle incoming chat messages
  useEffect(() => {
    setOnDataReceived((data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d && d.id && d.text && d.type) {
        const msg: Message = {
          id: d.id as string,
          text: d.text as string,
          sender: "partner",
          senderDeviceId: d.senderDeviceId as string | undefined,
          timestamp: (d.timestamp as number) || Date.now(),
          type: d.type as "text" | "image",
        };
        addMessage(msg);

        // Push notification if document hidden
        try {
          if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("New Message", {
                body: msg.type === "text" ? msg.text : "📷 Image",
                icon: "/icon.svg",
              });
            } catch {
              navigator.serviceWorker?.ready.then(reg =>
                reg.showNotification("New Message", {
                  body: msg.type === "text" ? msg.text : "📷 Image",
                  icon: "/icon.svg",
                }),
              );
            }
          }
        } catch { /* ignore notification errors */ }
      }
    });
  }, [setOnDataReceived, addMessage]);

  const handleSendMessage = useCallback(
    (text: string, type: "text" | "image") => {
      const msg: Message = {
        id: crypto.randomUUID(),
        text,
        sender: "me",
        senderDeviceId: MY_DEVICE_ID,
        timestamp: Date.now(),
        type,
      };

      // Include senderDeviceId in the wire payload for multi-user colors
      const wireMsg = { ...msg, senderDeviceId: MY_DEVICE_ID };
      const success = sendData(wireMsg);
      if (success) {
        addMessage(msg);
        setSendError(null);
      } else {
        setSendError("No relay connected — message not delivered.");
        addMessage({ ...msg, text: `⚠️ ${msg.text}` });
      }
    },
    [sendData, addMessage],
  );

  const handleLogin = useCallback((pw: string) => {
    localStorage.setItem(SESSION_KEY, pw);
    setPassword(pw);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setPassword(null);
    setSendError(null);
  }, []);

  const handleRetry = useCallback(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) { setPassword(null); setTimeout(() => setPassword(saved), 50); }
  }, []);

  const handleClearHistory = useCallback(() => {
    clearHistory();       // local clear
    broadcastClear();     // tell all other devices
  }, [clearHistory, broadcastClear]);

  return (
    <AnimatePresence mode="wait">
      {!password || !isReady ? (
        <motion.div
          key="login"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="h-[100dvh] w-full"
        >
          <Login onLogin={handleLogin} />
        </motion.div>
      ) : (
        <motion.div
          key="chat"
          initial={{ opacity: 0, scale: 1.02 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="h-[100dvh] w-full"
        >
          <Chat
            messages={messages}
            onSendMessage={handleSendMessage}
            status={status}
            onClearHistory={handleClearHistory}
            sendError={sendError}
            onDismissSendError={() => setSendError(null)}
            onLogout={handleLogout}
            myDeviceId={MY_DEVICE_ID}
            participants={participants}
            onRetry={handleRetry}
            peerError={peerError}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
