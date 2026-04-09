import React, { useState, useEffect, useCallback } from "react";
import { Login } from "./components/Login";
import { Chat } from "./components/Chat";
import { useNostr, getDeviceId } from "./hooks/useNostr";
import { useChat, Message } from "./hooks/useChat";
import { AnimatePresence, motion } from "motion/react";

const SESSION_KEY = "sc_session_key";
const MY_DEVICE_ID = getDeviceId();

export default function App() {
  const [password, setPassword] = useState<string | null>(() =>
    localStorage.getItem(SESSION_KEY),
  );
  const [sendError, setSendError] = useState<string | null>(null);

  const {
    status,
    error: peerError,
    role,
    participants,
    typingUsers,
    sendData,
    broadcastClear,
    broadcastClearMsg,
    broadcastSyncReq,
    broadcastRead,
    broadcastTyping,
    setOnDataReceived,
    setOnClear,
    setOnClearMsg,
    setOnRead,
    setOnSyncReq,
  } = useNostr(password);

  const {
    messages,
    addMessage,
    deleteMessage,
    markRead,
    markViewed,
    clearHistory,
    isReady,
  } = useChat(password);

  // ---- Remote Data Wiring ----

  useEffect(() => {
    setOnClear(() => clearHistory());
    setOnClearMsg((id) => deleteMessage(id));
    setOnRead((msgId, devId) => markRead(msgId, devId));
    setOnSyncReq((devId) => {
      // Re-broadcast our presence when someone requests sync
      // (Actual message sync handles via Nostr's 24h subscribe window, but
      // this helps us detect who is currently active).
    });
  }, [
    setOnClear,
    setOnClearMsg,
    setOnRead,
    setOnSyncReq,
    clearHistory,
    deleteMessage,
    markRead,
  ]);

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
          viewOnce: !!d.viewOnce,
          expiresIn: d.expiresIn as number | undefined,
        };
        addMessage(msg);

        // Auto-read receipt logic: if doc not hidden, we read it immediately
        if (!document.hidden) {
          broadcastRead(msg.id);
        } else {
          // Push notification if document hidden
          try {
            if (
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              try {
                new Notification("New Message", {
                  body: msg.viewOnce
                    ? "📷 View Once Photo"
                    : msg.type === "text"
                      ? msg.text
                      : "📷 Image",
                  icon: "/icon.svg",
                });
              } catch {
                navigator.serviceWorker?.ready.then((reg) =>
                  reg.showNotification("New Message", {
                    body: msg.viewOnce
                      ? "📷 View Once Photo"
                      : msg.type === "text"
                        ? msg.text
                        : "📷 Image",
                    icon: "/icon.svg",
                  }),
                );
              }
            }
          } catch {
            /* ignore notification errors */
          }
        }
      }
    });
  }, [setOnDataReceived, addMessage, broadcastRead]);

  // When window becomes visible, send read receipts for all unread messages
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) {
        const unread = messages.filter(
          (m) =>
            m.sender === "partner" && !(m.readBy || []).includes(MY_DEVICE_ID),
        );
        unread.forEach((m) => broadcastRead(m.id));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [messages, broadcastRead]);

  // ---- Actions Wiring ----

  const handleSendMessage = useCallback(
    (
      text: string,
      type: "text" | "image",
      opts?: { viewOnce?: boolean; expiresIn?: number },
    ) => {
      const msg: Message = {
        id: crypto.randomUUID(),
        text,
        sender: "me",
        senderDeviceId: MY_DEVICE_ID,
        timestamp: Date.now(),
        type,
        viewOnce: opts?.viewOnce,
        expiresIn: opts?.expiresIn,
        readBy: [], // explicitly empty initially
      };

      const wireMsg = { ...msg }; // senderDeviceId is already inside
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

  const handleClearHistory = useCallback(() => {
    clearHistory();
    broadcastClear();
  }, [clearHistory, broadcastClear]);

  const handleClearMsg = useCallback(
    (id: string) => {
      deleteMessage(id);
      broadcastClearMsg(id);
    },
    [deleteMessage, broadcastClearMsg],
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
          <Login
            onLogin={(pw) => {
              localStorage.setItem(SESSION_KEY, pw);
              setPassword(pw);
            }}
          />
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
            myDeviceId={MY_DEVICE_ID}
            participants={participants}
            typingUsers={typingUsers}
            onSendMessage={handleSendMessage}
            status={status}
            sendError={sendError}
            peerError={peerError}
            onRetry={() => {
              const saved = localStorage.getItem(SESSION_KEY);
              if (saved) {
                setPassword(null);
                setTimeout(() => setPassword(saved), 50);
              }
            }}
            onClearHistory={handleClearHistory}
            onClearMsg={handleClearMsg}
            onMarkViewed={markViewed}
            onSyncReq={broadcastSyncReq}
            onTyping={broadcastTyping}
            onDismissSendError={() => setSendError(null)}
            onLogout={() => {
              localStorage.removeItem(SESSION_KEY);
              setPassword(null);
              setSendError(null);
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
