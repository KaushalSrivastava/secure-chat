import { useState, useEffect, useCallback, useRef } from "react";
import {
  deriveKey,
  encryptMessage,
  decryptMessage,
  hashString,
} from "../lib/crypto";
import { io, Socket } from "socket.io-client";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "waiting"
  | "connected"
  | "error";

export type PeerRole = string | null;

const PRESENCE_TIMEOUT_MS = 45_000;

// ---- Types ----
type MsgEnvelope =
  | { msgType: "chat"; payload: Record<string, unknown> }
  | { msgType: "clear"; ts: number }
  | { msgType: "clear_msg"; id: string }
  | { msgType: "presence"; deviceId: string; ts: number; nickname?: string; country?: string; timezone?: string }
  | { msgType: "sync_req"; deviceId: string }
  | { msgType: "read"; msgId: string; deviceId: string }
  | { msgType: "typing"; deviceId: string; isTyping: boolean }
  | { msgType: "reaction"; msgId: string; emoji: string; deviceId: string };

export function getDeviceId(): string {
  const KEY = "sc_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function useSocket(password: string | null, nickname?: string, country?: string, timezone?: string) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [role] = useState<PeerRole>(() => getDeviceId());
  const [participants, setParticipants] = useState<string[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);
  const roomIdRef = useRef<string>("");
  const seenIds = useRef<Set<string>>(new Set());
  const presenceMap = useRef<Map<string, number>>(new Map());
  const typingMap = useRef<Map<string, number>>(new Map());
  const profileMap = useRef<Record<string, {nickname: string, country?: string, timezone?: string}>>({});

  // Callbacks
  const onDataRef = useRef<(data: unknown) => void>();
  const onClearRef = useRef<() => void>();
  const onClearMsgRef = useRef<(id: string) => void>();
  const onReadRef = useRef<(msgId: string, deviceId: string) => void>();
  const onSyncReqRef = useRef<(deviceId: string) => void>();
  const onReactionRef = useRef<(msgId: string, emoji: string, deviceId: string) => void>();

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
  const setOnReaction = useCallback((cb: (msgId: string, emoji: string, devId: string) => void) => {
    onReactionRef.current = cb;
  }, []);

  const publish = useCallback(
    async (envelope: MsgEnvelope): Promise<boolean> => {
      const cryptoKey = cryptoKeyRef.current;
      const socket = socketRef.current;
      if (!cryptoKey || !socket || socket.disconnected || !roomIdRef.current)
        return false;

      const plaintext = JSON.stringify(envelope);
      const payload = await encryptMessage(plaintext, cryptoKey);

      const payloadId = crypto.randomUUID(); // Unique msg ident to prevent loopback processing if needed

      const wire = {
        id: payloadId,
        content: JSON.stringify(payload),
        senderDevice: myDeviceId,
      };

      socket.emit("send_message", { roomId: roomIdRef.current, message: wire });
      return true;
    },
    [myDeviceId],
  );

  const sendData = useCallback(
    (data: unknown) => {
      publish({ msgType: "chat", payload: data as Record<string, unknown> });
      return socketRef.current?.connected ?? false;
    },
    [publish],
  );

  const broadcastClear = useCallback(() => {
    publish({ msgType: "clear", ts: Date.now() });
    socketRef.current?.emit("clear_history", { roomId: roomIdRef.current });
  }, [publish]);

  const broadcastClearMsg = useCallback(
    (id: string) => publish({ msgType: "clear_msg", id }),
    [publish],
  );

  const broadcastSyncReq = useCallback(() => {
    publish({ msgType: "sync_req", deviceId: myDeviceId });
  }, [publish, myDeviceId]);

  const broadcastRead = useCallback(
    (msgId: string) =>
      publish({ msgType: "read", msgId, deviceId: myDeviceId }),
    [publish, myDeviceId],
  );

  const broadcastTyping = useCallback(
    (isTyping: boolean) =>
      publish({ msgType: "typing", deviceId: myDeviceId, isTyping }),
    [publish, myDeviceId],
  );

  const broadcastReaction = useCallback(
    (msgId: string, emoji: string) =>
      publish({ msgType: "reaction", msgId, emoji, deviceId: myDeviceId }),
    [publish, myDeviceId],
  );

  const updatePresence = useCallback(
    (senderDevice: string, senderNickname?: string, senderCountry?: string, senderTimezone?: string) => {
      presenceMap.current.set(senderDevice, Date.now());
      if (senderNickname) {
        profileMap.current[senderDevice] = {
          nickname: senderNickname,
          country: senderCountry || profileMap.current[senderDevice]?.country,
          timezone: senderTimezone || profileMap.current[senderDevice]?.timezone
        };
      }
      const active = [...presenceMap.current.entries()]
        .filter(([, ts]) => Date.now() - ts < PRESENCE_TIMEOUT_MS)
        .map(([id]) => id);
      setParticipants(active);
    },
    [],
  );

  const handleDecrypted = useCallback(
    (envelope: MsgEnvelope, senderDevice: string) => {
      // For presence we extract profile
      const senderNick = envelope.msgType === "presence" ? envelope.nickname : undefined;
      const senderCountry = envelope.msgType === "presence" ? envelope.country : undefined;
      const senderTimezone = envelope.msgType === "presence" ? envelope.timezone : undefined;
      updatePresence(senderDevice, senderNick, senderCountry, senderTimezone);

      if (envelope.msgType === "typing") {
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
      } else if (envelope.msgType === "reaction") {
        onReactionRef.current?.(envelope.msgId, envelope.emoji, envelope.deviceId);
      } else if (envelope.msgType === "chat") {
        typingMap.current.delete(senderDevice);
        setTypingUsers([...typingMap.current.keys()]);
        onDataRef.current?.(envelope.payload);
      }
    },
    [updatePresence],
  );

  useEffect(() => {
    if (!password) return;

    let isMounted = true;
    let socket: Socket;

    const init = async () => {
      setStatus("connecting");
      const [cryptoKey, hash] = await Promise.all([
        deriveKey(password),
        hashString(password),
      ]);

      if (!isMounted) return;
      cryptoKeyRef.current = cryptoKey;
      roomIdRef.current = hash.substring(0, 32);

      // Bypassing Vite WebSocket entirely to prevent EPIPE closed-connection errors. 
      // We calculate the exact hostname dynamically to allow connections over local network IPs on mobile devices.
      const SOCKET_URL = import.meta.env.DEV ? `http://${window.location.hostname}:3001` : undefined;
      socket = io(SOCKET_URL, {
        reconnectionDelayMax: 10000,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        if (!isMounted) return;
        setStatus("connected");
        // Join with our data
        socket.emit("join_room", {
          roomId: roomIdRef.current,
          user: { deviceId: myDeviceId, nickname },
        });

        // Broadcast presence
        publish({
          msgType: "presence",
          deviceId: myDeviceId,
          ts: Date.now(),
          nickname,
          country,
          timezone,
        });
      });

      socket.on("connect_error", (err) => {
        if (isMounted) {
          setError(err.message);
          setStatus("error");
        }
      });

      socket.on("disconnect", () => {
        if (isMounted) setStatus("disconnected");
      });

      // Handle raw messages from server over socket
      const processWireMsg = async (wireMsg: any) => {
        if (!isMounted || !cryptoKeyRef.current) return;
        if (wireMsg.senderDevice === myDeviceId) return;
        if (seenIds.current.has(wireMsg.id)) return;
        seenIds.current.add(wireMsg.id);

        try {
          const payload = JSON.parse(wireMsg.content);
          const plain = await decryptMessage(payload, cryptoKeyRef.current);
          const envelope: MsgEnvelope = JSON.parse(plain);
          handleDecrypted(envelope, wireMsg.senderDevice);
        } catch {
          // decrypt error
        }
      };

      socket.on("new_message", (wireMsg) => {
        processWireMsg(wireMsg);
      });

      socket.on("room_history", async (messages) => {
        // Process history instantly
        for (const m of messages) {
          await processWireMsg(m);
        }
      });

      socket.on("session_expired", () => {
        onClearRef.current?.();
      });

      socket.on("history_cleared", () => {
        onClearRef.current?.();
      });
    };

    init();

    // Ping presence purely client side via socket publish
    const presenceTimer = setInterval(() => {
      if (status === "connected") {
        publish({
          msgType: "presence",
          deviceId: myDeviceId,
          ts: Date.now(),
          nickname,
          country,
          timezone,
        });
      }
    }, 15000);

    const pruneTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, ts] of presenceMap.current) {
        if (now - ts > PRESENCE_TIMEOUT_MS) {
          presenceMap.current.delete(id);
          changed = true;
        }
      }
      if (changed) setParticipants([...presenceMap.current.keys()]);
    }, 10000);

    return () => {
      isMounted = false;
      clearInterval(presenceTimer);
      clearInterval(pruneTimer);
      if (socket) {
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [password, nickname, country, timezone, myDeviceId, publish, handleDecrypted]);

  return {
    status,
    error,
    role,
    participants,
    typingUsers,
    profiles: profileMap.current,
    sendData,
    broadcastClear,
    broadcastClearMsg,
    broadcastSyncReq,
    broadcastRead,
    broadcastTyping,
    broadcastReaction,
    setOnDataReceived,
    setOnClear,
    setOnClearMsg,
    setOnRead,
    setOnSyncReq,
    setOnReaction,
  };
}
