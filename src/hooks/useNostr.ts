/**
 * useNostr — Nostr relay-based transport.
 *
 * Features:
 * - N-user sessions (not limited to 2)
 * - History sync on join (last 24h from relays)
 * - Cross-device clear broadcast
 * - Presence pings with participant tracking
 * - Message deduplication by event ID
 * - Auto-reconnect with exponential backoff
 * - Status reflects real relay connectivity
 * - Typing indicators & Read receipts
 * - Ephemeral message deletion
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { deriveKey, encryptMessage, decryptMessage } from "../lib/crypto";
import {
  derivePrivKey,
  getPublicKey,
  createEvent,
  nostrSub,
  nostrClose,
  nostrPublish,
  type NostrEvent,
} from "../lib/nostr";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "waiting"
  | "connected"
  | "error";

export type PeerRole = string | null;

const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
];

const SUB_ID = "scc-sub";
const PRESENCE_INTERVAL_MS = 15_000;
const PRESENCE_TIMEOUT_MS = 45_000;
const HISTORY_WINDOW_S = 86_400; // 24 hours

// ---- Types ----
type MsgEnvelope =
  | { msgType: "chat"; payload: Record<string, unknown> }
  | { msgType: "clear"; ts: number }
  | { msgType: "clear_msg"; id: string }
  | { msgType: "presence"; deviceId: string; ts: number }
  | { msgType: "sync_req"; deviceId: string }
  | { msgType: "read"; msgId: string; deviceId: string }
  | { msgType: "typing"; deviceId: string; isTyping: boolean };

export function getDeviceId(): string {
  const KEY = "sc_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function useNostr(password: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [role] = useState<PeerRole>(() => getDeviceId());
  const [participants, setParticipants] = useState<string[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  const statusRef = useRef<ConnectionStatus>("disconnected");
  const socketsRef = useRef<WebSocket[]>([]);
  const privKeyRef = useRef<Uint8Array | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);
  const pubkeyRef = useRef<string>("");
  const seenIds = useRef<Set<string>>(new Set());
  const presenceMap = useRef<Map<string, number>>(new Map());
  const typingMap = useRef<Map<string, number>>(new Map());

  // Callbacks
  const onDataRef = useRef<(data: unknown) => void>();
  const onClearRef = useRef<() => void>();
  const onClearMsgRef = useRef<(id: string) => void>();
  const onReadRef = useRef<(msgId: string, deviceId: string) => void>();
  const onSyncReqRef = useRef<(deviceId: string) => void>();

  const myDeviceId = useRef(getDeviceId()).current;

  const setOnDataReceived = useCallback((cb: (d: unknown) => void) => {
    onDataRef.current = cb;
  }, []);
  const setOnClear = useCallback((cb: () => void) => {
    onClearRef.current = cb;
  }, []);
  const setOnClearMsg = useCallback((cb: (id: string) => void) => {
    onClearMsgRef.current = cb;
  }, []);
  const setOnRead = useCallback(
    (cb: (msgId: string, devId: string) => void) => {
      onReadRef.current = cb;
    },
    [],
  );
  const setOnSyncReq = useCallback((cb: (devId: string) => void) => {
    onSyncReqRef.current = cb;
  }, []);

  const setS = useCallback((s: ConnectionStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const publish = useCallback(
    async (envelope: MsgEnvelope): Promise<boolean> => {
      const privKey = privKeyRef.current;
      const cryptoKey = cryptoKeyRef.current;
      if (!privKey || !cryptoKey) return false;

      const plaintext = JSON.stringify(envelope);
      const payload = await encryptMessage(plaintext, cryptoKey);
      const content = JSON.stringify(payload);
      const event = await createEvent(content, [["d", myDeviceId]], privKey);
      const wire = nostrPublish(event);

      let sent = false;
      for (const ws of socketsRef.current) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(wire);
          sent = true;
        }
      }
      return sent;
    },
    [myDeviceId],
  );

  // Public methods
  const sendData = useCallback(
    (data: unknown) => {
      publish({ msgType: "chat", payload: data as Record<string, unknown> });
      return socketsRef.current.some((ws) => ws.readyState === WebSocket.OPEN);
    },
    [publish],
  );

  const broadcastClear = useCallback(() => {
    publish({ msgType: "clear", ts: Date.now() });
  }, [publish]);
  const broadcastClearMsg = useCallback(
    (id: string) => {
      publish({ msgType: "clear_msg", id });
    },
    [publish],
  );
  const broadcastSyncReq = useCallback(() => {
    publish({ msgType: "sync_req", deviceId: myDeviceId });
  }, [publish, myDeviceId]);
  const broadcastRead = useCallback(
    (msgId: string) => {
      publish({ msgType: "read", msgId, deviceId: myDeviceId });
    },
    [publish, myDeviceId],
  );
  const broadcastTyping = useCallback(
    (isTyping: boolean) => {
      publish({ msgType: "typing", deviceId: myDeviceId, isTyping });
    },
    [publish, myDeviceId],
  );

  const updatePresence = useCallback(
    (senderDevice: string) => {
      presenceMap.current.set(senderDevice, Date.now());
      const active = [...presenceMap.current.entries()]
        .filter(([, ts]) => Date.now() - ts < PRESENCE_TIMEOUT_MS)
        .map(([id]) => id);
      setParticipants(active);
      if (statusRef.current === "waiting" || statusRef.current === "connecting")
        setS("connected");
    },
    [setS],
  );

  const handleDecrypted = useCallback(
    (envelope: MsgEnvelope, senderDevice: string) => {
      // Always update presence for ANY active message type received
      updatePresence(senderDevice);

      if (envelope.msgType === "presence") {
        // Just presence, already updated
      } else if (envelope.msgType === "typing") {
        if (envelope.isTyping)
          typingMap.current.set(envelope.deviceId, Date.now());
        else typingMap.current.delete(envelope.deviceId);
        setTypingUsers([...typingMap.current.keys()]);
      } else if (envelope.msgType === "clear") {
        onClearRef.current?.();
      } else if (envelope.msgType === "clear_msg") {
        onClearMsgRef.current?.(envelope.id);
      } else if (envelope.msgType === "read") {
        onReadRef.current?.(envelope.msgId, envelope.deviceId);
      } else if (envelope.msgType === "sync_req") {
        onSyncReqRef.current?.(envelope.deviceId);
      } else if (envelope.msgType === "chat") {
        typingMap.current.delete(senderDevice); // Stop typing on message
        setTypingUsers([...typingMap.current.keys()]);
        onDataRef.current?.(envelope.payload);
      }
    },
    [updatePresence],
  );

  useEffect(() => {
    if (!password) return;

    let isMounted = true;
    const sockets: WebSocket[] = [];
    socketsRef.current = sockets;
    const retryTimers: ReturnType<typeof setTimeout>[] = [];
    let presenceTimer: ReturnType<typeof setInterval>;
    let pruneTimer: ReturnType<typeof setInterval>;
    let typingTimer: ReturnType<typeof setInterval>;

    const init = async () => {
      setS("connecting");
      const [privKey, cryptoKey] = await Promise.all([
        Promise.resolve(derivePrivKey(password)),
        deriveKey(password),
      ]);
      if (!isMounted) return;

      privKeyRef.current = privKey;
      cryptoKeyRef.current = cryptoKey;
      pubkeyRef.current = getPublicKey(privKey);

      const filter = {
        kinds: [1],
        authors: [pubkeyRef.current],
        since: Math.floor(Date.now() / 1000) - HISTORY_WINDOW_S,
      };

      const connectRelay = (url: string, retryMs = 4000) => {
        if (!isMounted) return;
        const ws = new WebSocket(url);
        sockets.push(ws);

        ws.onopen = () => {
          if (!isMounted) {
            ws.close();
            return;
          }
          console.log("[nostr] relay open:", url);
          ws.send(nostrSub(SUB_ID, filter));
          if (
            statusRef.current === "connecting" ||
            statusRef.current === "disconnected"
          )
            setS("waiting");
          publish({
            msgType: "presence",
            deviceId: myDeviceId,
            ts: Date.now(),
          });
        };

        ws.onmessage = async (ev) => {
          if (!isMounted) return;
          try {
            const msg = JSON.parse(ev.data as string);
            if (!Array.isArray(msg) || msg[0] !== "EVENT") return;
            const event: NostrEvent = msg[2];
            if (
              !event?.id ||
              !event?.content ||
              event.pubkey !== pubkeyRef.current
            )
              return;
            if (seenIds.current.has(event.id)) return;
            seenIds.current.add(event.id);

            const deviceTag = event.tags.find((t) => t[0] === "d");
            const senderDevice = deviceTag?.[1];
            if (!senderDevice || senderDevice === myDeviceId) return;

            const cKey = cryptoKeyRef.current;
            if (!cKey) return;
            try {
              const payload = JSON.parse(event.content);
              const plain = await decryptMessage(payload, cKey);
              const envelope: MsgEnvelope = JSON.parse(plain);
              handleDecrypted(envelope, senderDevice);
            } catch {
              /* parse err */
            }
          } catch {
            /* msg err */
          }
        };

        ws.onclose = () => {
          if (!isMounted) return;
          const idx = sockets.indexOf(ws);
          if (idx !== -1) sockets.splice(idx, 1);
          if (
            !sockets.some((s) => s.readyState === WebSocket.OPEN) &&
            statusRef.current !== "error"
          )
            setS("disconnected");
          const delay = Math.min(retryMs, 60_000);
          retryTimers.push(
            setTimeout(() => connectRelay(url, delay * 1.5), delay),
          );
        };
      };

      for (const url of RELAYS) connectRelay(url);

      presenceTimer = setInterval(() => {
        if (isMounted)
          publish({
            msgType: "presence",
            deviceId: myDeviceId,
            ts: Date.now(),
          });
      }, PRESENCE_INTERVAL_MS);

      pruneTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [id, ts] of presenceMap.current) {
          if (now - ts > PRESENCE_TIMEOUT_MS) {
            presenceMap.current.delete(id);
            changed = true;
          }
        }
        if (changed) setParticipants([...presenceMap.current.keys()]);
      }, PRESENCE_INTERVAL_MS);

      typingTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [id, ts] of typingMap.current) {
          if (now - ts > 10_000) {
            typingMap.current.delete(id);
            changed = true;
          } // expire typing
        }
        if (changed) setTypingUsers([...typingMap.current.keys()]);
      }, 2000);
    };

    init().catch((err) => {
      if (isMounted) {
        setS("error");
        setError(err.message);
      }
    });

    return () => {
      isMounted = false;
      retryTimers.forEach(clearTimeout);
      clearInterval(presenceTimer);
      clearInterval(pruneTimer);
      clearInterval(typingTimer);
      for (const ws of sockets) {
        try {
          ws.send(nostrClose(SUB_ID));
        } catch {
          /* ignore */
        }
        ws.close();
      }
      socketsRef.current = [];
      privKeyRef.current = null;
      cryptoKeyRef.current = null;
      seenIds.current.clear();
      presenceMap.current.clear();
      typingMap.current.clear();
      statusRef.current = "disconnected";
    };
  }, [password, myDeviceId, setS, publish, handleDecrypted]);

  return {
    status,
    error,
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
  };
}
