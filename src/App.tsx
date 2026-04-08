import React, { useState, useEffect, useCallback } from "react";
import { Login } from "./components/Login";
import { Chat } from "./components/Chat";
import { usePeer } from "./hooks/usePeer";
import { useChat, Message } from "./hooks/useChat";
import { AnimatePresence, motion } from "motion/react";

const SESSION_KEY = "sc_session_key";

export default function App() {
  const [password, setPassword] = useState<string | null>(
    () => localStorage.getItem(SESSION_KEY),
  );
  const [sendError, setSendError] = useState<string | null>(null);
  const { status, sendData, setOnDataReceived } = usePeer(password);
  const { messages, addMessage, clearHistory, isReady } = useChat(password);

  // Handle incoming messages
  useEffect(() => {
    setOnDataReceived((data: any) => {
      if (data && data.id && data.text && data.type) {
        const msg: Message = {
          id: data.id,
          text: data.text,
          sender: "partner",
          timestamp: data.timestamp || Date.now(),
          type: data.type,
        };
        addMessage(msg);

        // Show notification if permitted and document is hidden
        try {
          if (
            document.hidden &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            try {
              new Notification("New Message", {
                body: msg.type === "text" ? msg.text : "📷 Image",
                icon: "/pwa-192x192.png",
              });
            } catch (e) {
              // Fallback for Android Chrome which requires ServiceWorkerRegistration.showNotification
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then((registration) => {
                  registration.showNotification("New Message", {
                    body: msg.type === "text" ? msg.text : "📷 Image",
                    icon: "/pwa-192x192.png",
                  });
                });
              }
            }
          }
        } catch (err) {
          console.error("Notification error:", err);
        }
      }
    });
  }, [setOnDataReceived, addMessage]);

  const handleSendMessage = useCallback(
    (text: string, type: "text" | "image") => {
      const msg: Message = {
        id: Math.random().toString(36).substring(2, 9),
        text,
        sender: "me",
        timestamp: Date.now(),
        type,
      };

      const success = sendData(msg);
      if (success) {
        addMessage(msg);
        setSendError(null);
      } else {
        setSendError("Not connected — message not delivered.");
        // Still show locally so user can retry / copy the text
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
            onClearHistory={clearHistory}
            sendError={sendError}
            onDismissSendError={() => setSendError(null)}
            onLogout={handleLogout}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
