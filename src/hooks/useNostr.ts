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

export type PeerRole = string | null; // deviceId of this device, null before ready

const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.mom",
];

const SUB_ID = "scc-sub";
const PRESENCE_INTERVAL_MS = 15_000;
const PRESENCE_TIMEOUT_MS = 45_000; // consider device gone after 45s no ping
const HISTORY_WINDOW_S = 86_400; // 24 hours

// ---- Types ----
type MsgEnvelope =
  | { msgType: "chat"; payload: Record<string, unknown> }
  | { msgType: "clear"; ts: number }
  | { msgType: "presence"; deviceId: string; ts: number };

// ---- Stable device ID ----
export function getDeviceId(): string {
  const KEY = "sc_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
  return id;
}

export function useNostr(password: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [role] = useState<PeerRole>(() => getDeviceId()); // role = this device's ID
  const [participants, setParticipants] = useState<string[]>([]);

  const statusRef = useRef<ConnectionStatus>("disconnected");
  const onDataRef = useRef<(data: unknown) => void>();
  const onClearRef = useRef<(() => void) | undefined>(undefined);
  const socketsRef = useRef<WebSocket[]>([]);
  const privKeyRef = useRef<Uint8Array | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);
  const pubkeyRef = useRef<string>("");
  const seenIds = useRef<Set<string>>(new Set());
  // Map<deviceId, lastSeenTs>
  const presenceMap = useRef<Map<string, number>>(new Map());

  const myDeviceId = useRef(getDeviceId()).current;

  const setOnDataReceived = useCallback((cb: (data: unknown) => void) => {
    onDataRef.current = cb;
  }, []);

  const setOnClear = useCallback((cb: () => void) => {
    onClearRef.current = cb;
  }, []);

  const setS = useCallback((s: ConnectionStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // ---- Send a raw encrypted Nostr event to all open sockets ----
  const publish = useCallback(async (envelope: MsgEnvelope): Promise<boolean> => {
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
      if (ws.readyState === WebSocket.OPEN) { ws.send(wire); sent = true; }
    }
    return sent;
  }, [myDeviceId]);

  // ---- Public: send a chat message ----
  const sendData = useCallback((data: unknown): boolean => {
    publish({ msgType: "chat", payload: data as Record<string, unknown> });
    return socketsRef.current.some(ws => ws.readyState === WebSocket.OPEN);
  }, [publish]);

  // ---- Public: broadcast clear to all session participants ----
  const broadcastClear = useCallback(async () => {
    await publish({ msgType: "clear", ts: Date.now() });
  }, [publish]);

  // ---- Process incoming decrypted event ----
  const handleDecrypted = useCallback(
    (envelope: MsgEnvelope, senderDevice: string) => {
      if (envelope.msgType === "presence") {
        presenceMap.current.set(senderDevice, envelope.ts);
        // Derive active participants
        const now = Date.now();
        const active = [...presenceMap.current.entries()]
          .filter(([, ts]) => now - ts < PRESENCE_TIMEOUT_MS)
          .map(([id]) => id);
        setParticipants(active);
        if (statusRef.current === "waiting" || statusRef.current === "connecting") {
          statusRef.current = "connected";
          setStatus("connected");
        }
      } else if (envelope.msgType === "clear") {
        onClearRef.current?.();
      } else if (envelope.msgType === "chat") {
        onDataRef.current?.(envelope.payload);
        if (statusRef.current === "waiting" || statusRef.current === "connecting") {
          statusRef.current = "connected";
          setStatus("connected");
        }
      }
    },
    [],
  );

  // ---- Relay connection management ----
  useEffect(() => {
    if (!password) return;

    let isMounted = true;
    const sockets: WebSocket[] = [];
    socketsRef.current = sockets;
    const retryTimers: ReturnType<typeof setTimeout>[] = [];
    let presenceTimer: ReturnType<typeof setInterval> | null = null;
    let presencePruneTimer: ReturnType<typeof setInterval> | null = null;

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
        // Fetch last 24h so new joiners get history
        since: Math.floor(Date.now() / 1000) - HISTORY_WINDOW_S,
      };

      const connectRelay = (url: string, retryMs = 2000) => {
        if (!isMounted) return;
        const ws = new WebSocket(url);
        sockets.push(ws);

        ws.onopen = () => {
          if (!isMounted) { ws.close(); return; }
          console.log("[nostr] relay open:", url);
          ws.send(nostrSub(SUB_ID, filter));
          // A relay is open → at least "waiting"
          if (statusRef.current === "connecting" || statusRef.current === "disconnected") {
            setS("waiting");
          }
          // Send our presence immediately
          publish({ msgType: "presence", deviceId: myDeviceId, ts: Date.now() });
        };

        ws.onmessage = async (ev) => {
          if (!isMounted) return;
          try {
            const msg = JSON.parse(ev.data as string);
            if (!Array.isArray(msg) || msg[0] !== "EVENT") return;
            const event: NostrEvent = msg[2];
            if (!event?.id || !event?.content) return;
            if (event.pubkey !== pubkeyRef.current) return;
            if (seenIds.current.has(event.id)) return; // deduplicate
            seenIds.current.add(event.id);

            const deviceTag = event.tags.find(t => t[0] === "d");
            const senderDevice = deviceTag?.[1];
            if (!senderDevice || senderDevice === myDeviceId) return; // own echo

            const cKey = cryptoKeyRef.current;
            if (!cKey) return;
            try {
              const payload = JSON.parse(event.content);
              const plain = await decryptMessage(payload, cKey);
              const envelope: MsgEnvelope = JSON.parse(plain);
              handleDecrypted(envelope, senderDevice);
            } catch {
              // wrong key or malformed — skip
            }
          } catch { /* parse error */ }
        };

        ws.onerror = () => console.warn("[nostr] relay error:", url);

        ws.onclose = () => {
          if (!isMounted) return;
          const idx = sockets.indexOf(ws);
          if (idx !== -1) sockets.splice(idx, 1);
          const anyOpen = sockets.some(s => s.readyState === WebSocket.OPEN);
          if (!anyOpen && statusRef.current !== "error") setS("disconnected");
          // Exponential backoff reconnect (max 30s)
          const delay = Math.min(retryMs, 30_000);
          const t = setTimeout(() => connectRelay(url, delay * 2), delay);
          retryTimers.push(t);
        };
      };

      for (const url of RELAYS) connectRelay(url);

      // Periodic presence ping
      presenceTimer = setInterval(() => {
        if (!isMounted) return;
        publish({ msgType: "presence", deviceId: myDeviceId, ts: Date.now() });
      }, PRESENCE_INTERVAL_MS);

      // Prune stale participants
      presencePruneTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [id, ts] of presenceMap.current) {
          if (now - ts > PRESENCE_TIMEOUT_MS) {
            presenceMap.current.delete(id);
            changed = true;
          }
        }
        if (changed) {
          setParticipants([...presenceMap.current.keys()]);
        }
      }, PRESENCE_INTERVAL_MS);
    };

    init().catch(err => {
      if (isMounted) { setS("error"); setError(err.message); }
    });

    return () => {
      isMounted = false;
      retryTimers.forEach(clearTimeout);
      if (presenceTimer) clearInterval(presenceTimer);
      if (presencePruneTimer) clearInterval(presencePruneTimer);
      for (const ws of sockets) {
        try { ws.send(nostrClose(SUB_ID)); } catch { /* ignore */ }
        ws.close();
      }
      socketsRef.current = [];
      privKeyRef.current = null;
      cryptoKeyRef.current = null;
      seenIds.current.clear();
      presenceMap.current.clear();
      statusRef.current = "disconnected";
    };
  }, [password, myDeviceId, setS, publish, handleDecrypted]);

  return {
    status,
    error,
    role,          // this device's ID (used for bubble color + "isMe" check)
    participants,  // array of OTHER active device IDs
    sendData,
    broadcastClear,
    setOnDataReceived,
    setOnClear,
  };
}
