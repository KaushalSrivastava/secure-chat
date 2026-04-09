import { useState, useEffect, useCallback, useRef } from "react";
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
  senderDeviceId?: string;
  timestamp: number;
  type: "text" | "image" | "audio";

  expiresIn?: number;
  isViewed?: boolean;
  readBy?: string[];
  replyToId?: string;
  reactions?: Record<string, string[]>;
  audioDuration?: number;
}

interface EncryptedStoredMessage {
  id: string;
  payload: EncryptedPayload;
  sender: "me" | "partner";
  senderDeviceId?: string;
  timestamp: number;
  type: "text" | "image" | "audio";
  expiresIn?: number;
  isViewed?: boolean;
  readBy?: string[];
  replyToId?: string;
  reactions?: Record<string, string[]>;
  audioDuration?: number;
}

interface ChatMeta {
  clearTs: number;
  deletedIds: string[];
}

const MS_IN_24_HOURS = 24 * 60 * 60 * 1000;

export function useChat(password: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [metaKey, setMetaKey] = useState<string | null>(null);
  const [meta, setMeta] = useState<ChatMeta>({ clearTs: 0, deletedIds: [] });
  const [isReady, setIsReady] = useState(false);

  const metaRef = useRef(meta);
  metaRef.current = meta;

  // Derive keys
  useEffect(() => {
    if (!password) {
      setCryptoKey(null);
      setStorageKey(null);
      setMetaKey(null);
      setIsReady(false);
      setMessages([]);
      return;
    }

    let isMounted = true;
    Promise.all([deriveKey(password), hashString(password)]).then(
      ([key, hash]) => {
        if (isMounted) {
          setCryptoKey(key);
          const hashPrefix = hash.substring(0, 16);
          setStorageKey(`scc_${hashPrefix}`);
          setMetaKey(`scc_meta_${hashPrefix}`);
        }
      },
    );

    return () => {
      isMounted = false;
    };
  }, [password]);

  // Load state
  useEffect(() => {
    if (!cryptoKey || !storageKey || !metaKey) return;

    const load = async () => {
      try {
        const storedMetaStr = localStorage.getItem(metaKey);
        let currentMeta: ChatMeta = { clearTs: 0, deletedIds: [] };
        if (storedMetaStr) {
          try {
            currentMeta = JSON.parse(storedMetaStr);
          } catch {
            /* ignore */
          }
          setMeta(currentMeta);
        }

        const stored = localStorage.getItem(storageKey);
        if (!stored) {
          setIsReady(true);
          return;
        }

        const encryptedMessages: EncryptedStoredMessage[] = JSON.parse(stored);
        const now = Date.now();

        const recentEncrypted = encryptedMessages.filter(
          (m) =>
            now - m.timestamp < MS_IN_24_HOURS &&
            m.timestamp > currentMeta.clearTs &&
            !currentMeta.deletedIds.includes(m.id),
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
              expiresIn: em.expiresIn,
              isViewed: em.isViewed,
              readBy: em.readBy || [],
              replyToId: em.replyToId,
              reactions: em.reactions || {},
              audioDuration: em.audioDuration,
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

    load();

    const interval = setInterval(() => {
      setMessages((current) =>
        current.filter((m) => Date.now() - m.timestamp < MS_IN_24_HOURS),
      );
    }, 60_000);

    return () => clearInterval(interval);
  }, [cryptoKey, storageKey, metaKey]);

  // Save messages
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
            expiresIn: m.expiresIn,
            isViewed: m.isViewed,
            readBy: m.readBy,
            replyToId: m.replyToId,
            reactions: m.reactions,
            audioDuration: m.audioDuration,
          });
        }
        localStorage.setItem(storageKey, JSON.stringify(encrypted));
      } catch (err) {
        console.error("Failed to save:", err);
      }
    };

    save();
  }, [messages, cryptoKey, storageKey, isReady]);

  // Save meta
  useEffect(() => {
    if (!metaKey || !isReady) return;
    localStorage.setItem(metaKey, JSON.stringify(meta));
  }, [meta, metaKey, isReady]);

  const addMessage = useCallback((message: Message) => {
    if (message.timestamp <= metaRef.current.clearTs) return;
    if (metaRef.current.deletedIds.includes(message.id)) return;

    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message].sort((a, b) => a.timestamp - b.timestamp);
    });
  }, []);

  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setMeta((prev) => ({
      ...prev,
      deletedIds: Array.from(new Set([...prev.deletedIds, id])).filter(
        (_, i, arr) => arr.length - i <= 1000,
      ), // keep last 1000 deleted max
    }));
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

  const addReaction = useCallback((msgId: string, emoji: string, deviceId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId) {
          const reactions = { ...(m.reactions || {}) };
          const users = [...(reactions[emoji] || [])];
          if (!users.includes(deviceId)) {
            users.push(deviceId);
          }
          reactions[emoji] = users;
          return { ...m, reactions };
        }
        return m;
      }),
    );
  }, []);

  const clearHistory = useCallback(
    (remoteTs?: number) => {
      const ts = remoteTs || Date.now();
      setMessages([]);
      setMeta((prev) => ({
        ...prev,
        clearTs: Math.max(prev.clearTs, ts),
        deletedIds: [],
      }));
      if (storageKey) localStorage.removeItem(storageKey);
    },
    [storageKey],
  );

  return {
    messages,
    addMessage,
    deleteMessage,
    markRead,
    addReaction,
    clearHistory,
    isReady,
  };
}
