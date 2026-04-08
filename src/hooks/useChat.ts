import { useState, useEffect, useCallback } from "react";
import {
  deriveKey,
  encryptMessage,
  decryptMessage,
  EncryptedPayload,
} from "../lib/crypto";

export interface Message {
  id: string;
  text: string;
  sender: "me" | "partner";
  timestamp: number;
  type: "text" | "image";
}

interface EncryptedStoredMessage {
  id: string;
  payload: EncryptedPayload;
  sender: "me" | "partner";
  timestamp: number;
  type: "text" | "image";
}

const STORAGE_KEY = "secure_chat_messages";
const MS_IN_24_HOURS = 24 * 60 * 60 * 1000;

export function useChat(password: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Initialize crypto key
  useEffect(() => {
    if (!password) {
      setCryptoKey(null);
      setIsReady(false);
      return;
    }

    let isMounted = true;
    deriveKey(password).then((key) => {
      if (isMounted) {
        setCryptoKey(key);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [password]);

  // Load and decrypt messages from local storage
  useEffect(() => {
    if (!cryptoKey) return;

    const loadMessages = async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          setIsReady(true);
          return;
        }

        const encryptedMessages: EncryptedStoredMessage[] = JSON.parse(stored);
        const now = Date.now();

        // Filter out messages older than 24 hours
        const recentEncrypted = encryptedMessages.filter(
          (m) => now - m.timestamp < MS_IN_24_HOURS,
        );

        // If we filtered some out, update storage
        if (recentEncrypted.length !== encryptedMessages.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(recentEncrypted));
        }

        const decryptedMessages: Message[] = [];
        for (const em of recentEncrypted) {
          try {
            const text = await decryptMessage(em.payload, cryptoKey);
            decryptedMessages.push({
              id: em.id,
              text,
              sender: em.sender,
              timestamp: em.timestamp,
              type: em.type,
            });
          } catch (err) {
            console.error("Failed to decrypt a message, skipping...", err);
          }
        }

        setMessages(decryptedMessages);
        setIsReady(true);
      } catch (err) {
        console.error("Failed to load messages:", err);
        setIsReady(true);
      }
    };

    loadMessages();

    // Periodic cleanup every minute
    const interval = setInterval(() => {
      setMessages((currentMessages) => {
        const now = Date.now();
        const filtered = currentMessages.filter(
          (m) => now - m.timestamp < MS_IN_24_HOURS,
        );
        if (filtered.length !== currentMessages.length) {
          // Re-save to local storage handled by addMessage? No, we need to save explicitly.
          // But saveMessages requires cryptoKey. We can just let the next addMessage save it,
          // or we can call saveMessages here. Since saveMessages is async and we are in a setState,
          // it's better to just trigger a re-save outside.
          return filtered;
        }
        return currentMessages;
      });
    }, 60000);

    return () => clearInterval(interval);
  }, [cryptoKey]);

  // Save messages to local storage whenever they change
  useEffect(() => {
    if (!cryptoKey || !isReady) return;

    const save = async () => {
      try {
        const encryptedMessages: EncryptedStoredMessage[] = [];
        for (const m of messages) {
          const payload = await encryptMessage(m.text, cryptoKey);
          encryptedMessages.push({
            id: m.id,
            payload,
            sender: m.sender,
            timestamp: m.timestamp,
            type: m.type,
          });
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedMessages));
      } catch (err) {
        console.error("Failed to save messages:", err);
      }
    };

    save();
  }, [messages, cryptoKey, isReady]);

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    messages,
    addMessage,
    clearHistory,
    isReady,
    cryptoKey,
  };
}
