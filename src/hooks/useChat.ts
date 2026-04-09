import { useState, useEffect, useCallback } from "react";
import {
  deriveKey,
  encryptMessage,
  decryptMessage,
  hashString,
  EncryptedPayload,
} from "../lib/crypto";

export interface Message {
  id: string;
  text: string;
  sender: "me" | "partner";
  senderDeviceId?: string; // for multi-user bubble colors
  timestamp: number;
  type: "text" | "image";

  // Premium features
  viewOnce?: boolean;
  expiresIn?: number; // seconds after viewing
  isViewed?: boolean; // local flag
  readBy?: string[]; // deviceIds that read it
}

interface EncryptedStoredMessage {
  id: string;
  payload: EncryptedPayload;
  sender: "me" | "partner";
  senderDeviceId?: string;
  timestamp: number;
  type: "text" | "image";
  viewOnce?: boolean;
  expiresIn?: number;
  isViewed?: boolean;
  readBy?: string[];
}

const MS_IN_24_HOURS = 24 * 60 * 60 * 1000;

export function useChat(password: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Derive crypto key + per-session storage key together
  useEffect(() => {
    if (!password) {
      setCryptoKey(null);
      setStorageKey(null);
      setIsReady(false);
      setMessages([]);
      return;
    }

    let isMounted = true;
    Promise.all([deriveKey(password), hashString(password)]).then(
      ([key, hash]) => {
        if (isMounted) {
          setCryptoKey(key);
          setStorageKey(`scc_${hash.substring(0, 16)}`);
        }
      },
    );

    return () => {
      isMounted = false;
    };
  }, [password]);

  // Load and decrypt messages from local storage once keys are ready
  useEffect(() => {
    if (!cryptoKey || !storageKey) return;

    const loadMessages = async () => {
      try {
        const stored = localStorage.getItem(storageKey);
        if (!stored) {
          setIsReady(true);
          return;
        }

        const encryptedMessages: EncryptedStoredMessage[] = JSON.parse(stored);
        const now = Date.now();

        // Filter out expired ephemeral messages or messages older than 24h
        const recentEncrypted = encryptedMessages.filter(
          (m) => now - m.timestamp < MS_IN_24_HOURS,
        );

        if (recentEncrypted.length !== encryptedMessages.length) {
          localStorage.setItem(storageKey, JSON.stringify(recentEncrypted));
        }

        const decryptedMessages: Message[] = [];
        for (const em of recentEncrypted) {
          try {
            const text = await decryptMessage(em.payload, cryptoKey);
            decryptedMessages.push({
              id: em.id,
              text,
              sender: em.sender,
              senderDeviceId: em.senderDeviceId,
              timestamp: em.timestamp,
              type: em.type,
              viewOnce: em.viewOnce,
              expiresIn: em.expiresIn,
              isViewed: em.isViewed,
              readBy: em.readBy || [],
            });
          } catch {
            /* skip */
          }
        }

        setMessages(decryptedMessages);
        setIsReady(true);
      } catch {
        setIsReady(true);
      }
    };

    loadMessages();

    // 24-hour cleanup interval
    const interval = setInterval(() => {
      setMessages((current) =>
        current.filter((m) => Date.now() - m.timestamp < MS_IN_24_HOURS),
      );
    }, 60_000);

    return () => clearInterval(interval);
  }, [cryptoKey, storageKey]);

  // Save messages to local storage whenever they change
  useEffect(() => {
    if (!cryptoKey || !storageKey || !isReady) return;

    const save = async () => {
      try {
        const encrypted: EncryptedStoredMessage[] = [];
        for (const m of messages) {
          const payload = await encryptMessage(m.text, cryptoKey);
          encrypted.push({
            id: m.id,
            payload,
            sender: m.sender,
            senderDeviceId: m.senderDeviceId,
            timestamp: m.timestamp,
            type: m.type,
            viewOnce: m.viewOnce,
            expiresIn: m.expiresIn,
            isViewed: m.isViewed,
            readBy: m.readBy,
          });
        }
        localStorage.setItem(storageKey, JSON.stringify(encrypted));
      } catch (err) {
        console.error("Failed to save messages:", err);
      }
    };

    save();
  }, [messages, cryptoKey, storageKey, isReady]);

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      // Deduplicate on add (useful for sync responses)
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message].sort((a, b) => a.timestamp - b.timestamp);
    });
  }, []);

  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const markRead = useCallback((msgId: string, deviceId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId) {
          const reads = m.readBy || [];
          if (!reads.includes(deviceId))
            return { ...m, readBy: [...reads, deviceId] };
        }
        return m;
      }),
    );
  }, []);

  const markViewed = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, isViewed: true } : m)),
    );
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    if (storageKey) localStorage.removeItem(storageKey);
  }, [storageKey]);

  return {
    messages,
    addMessage,
    deleteMessage,
    markRead,
    markViewed,
    clearHistory,
    isReady,
  };
}
