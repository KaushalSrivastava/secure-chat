import React, { useState, useEffect, useCallback } from "react";
import { Login } from "./components/Login";
import { Chat } from "./components/Chat";
import { usePeer } from "./hooks/usePeer";
import { useChat, Message } from "./hooks/useChat";
import { AnimatePresence, motion } from "motion/react";

export default function App() {
  const [password, setPassword] = useState<string | null>(null);
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

      // Send to partner
      const success = sendData(msg);

      // Add to local state even if not sent?
      // Yes, but maybe indicate if it wasn't sent. For simplicity, we just add it.
      // In a real app, we'd queue it. Since it's 1:1 and simple, we'll just add it.
      addMessage(msg);
    },
    [sendData, addMessage],
  );

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
          <Login onLogin={setPassword} />
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
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
