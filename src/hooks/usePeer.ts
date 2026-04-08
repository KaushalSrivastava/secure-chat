import { useState, useEffect, useCallback, useRef } from "react";
import Peer, { DataConnection } from "peerjs";
import { hashString } from "../lib/crypto";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "waiting"
  | "connected"
  | "error";

export type PeerRole = "A" | "B" | null;

const ICE_SERVERS: RTCIceServer[] = [
  // STUN — discover public IP for direct P2P (same-network connections)
  { urls: "stun:stun.l.google.com:19302" },      // Google (globally reliable)
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },      // Cloudflare backup
  { urls: "stun:openrelay.metered.ca:80" },       // Open Relay STUN

  // TURN UDP — relay for cross-network connectivity (Open Relay Project, free)
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:3478",
    username: "openrelayproject",
    credential: "openrelayproject",
  },

  // TURN TCP/443 — punches through corporate firewalls, looks like HTTPS
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },

  // TURNS — TURN over TLS, most secure and firewall-friendly
  {
    urls: "turns:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export function usePeer(password: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<PeerRole>(null);
  const statusRef = useRef<ConnectionStatus>("disconnected");

  // Stable refs — never change between renders
  const connRef = useRef<DataConnection | null>(null);
  const onDataReceivedRef = useRef<(data: any) => void>();

  const setOnDataReceived = useCallback((cb: (data: any) => void) => {
    onDataReceivedRef.current = cb;
  }, []);

  useEffect(() => {
    if (!password) return;

    let isMounted = true;
    let currentPeer: Peer | null = null;

    // Keep status and statusRef in sync — defined inside effect so closure is fresh
    const setStatusSynced = (s: ConnectionStatus) => {
      if (!isMounted) return;
      statusRef.current = s;
      setStatus(s);
    };

    const setupConnection = (conn: DataConnection) => {
      connRef.current = conn;

      const onOpen = () => {
        console.log("Connection open with:", conn.peer);
        setStatusSynced("connected");
        setError(null);
      };

      // Guard against the race where "open" fires before we attach the listener
      if (conn.open) {
        onOpen();
      } else {
        conn.on("open", onOpen);
      }

      conn.on("data", (data) => {
        onDataReceivedRef.current?.(data);
      });

      conn.on("close", () => {
        console.log("Connection closed");
        setStatusSynced("disconnected");
        connRef.current = null;
      });

      conn.on("error", (err) => {
        console.error("Connection error:", err);
        setStatusSynced("error");
        if (isMounted) setError(err.message);
      });
    };

    const initPeer = async () => {
      setStatusSynced("connecting");
      try {
        const hash = await hashString(password);
        const baseId = hash.substring(0, 16);
        const peerIdA = `sc-${baseId}-A`;
        const peerIdB = `sc-${baseId}-B`;

        // Try to become Peer A first
        const peerA = new Peer(peerIdA, {
          debug: 1,
          config: { iceServers: ICE_SERVERS },
        });

        peerA.on("open", (id) => {
          if (!isMounted) return;
          console.log("Registered as Peer A:", id);
          currentPeer = peerA;
          setRole("A");
          setStatusSynced("waiting");
        });

        peerA.on("connection", (conn) => {
          if (!isMounted) return;
          console.log("Peer B connected:", conn.peer);
          setupConnection(conn);
        });

        peerA.on("error", (err: any) => {
          if (!isMounted) return;

          if (err.type === "unavailable-id") {
            // Peer A slot is taken — we are the second user, become Peer B
            console.log("Peer A slot taken, becoming Peer B...");
            peerA.destroy();

            const peerB = new Peer(peerIdB, {
              debug: 1,
              config: { iceServers: ICE_SERVERS },
            });

            peerB.on("open", (id) => {
              if (!isMounted) return;
              console.log("Registered as Peer B:", id);
              currentPeer = peerB;
              setRole("B");
              // Dial Peer A
              console.log("Dialing Peer A:", peerIdA);
              const conn = peerB.connect(peerIdA, { reliable: true });
              setupConnection(conn);
            });

            peerB.on("error", (errB: any) => {
              if (!isMounted) return;
              console.error("Peer B error:", errB);
              setStatusSynced("error");
              setError(errB.message);
            });
          } else {
            console.error("Peer A error:", err);
            setStatusSynced("error");
            setError(err.message);
          }
        });
      } catch (err: any) {
        console.error("Init error:", err);
        if (isMounted) {
          setStatusSynced("error");
          setError(err.message);
        }
      }
    };

    initPeer();

    return () => {
      isMounted = false;
      if (connRef.current) {
        connRef.current.close();
        connRef.current = null;
      }
      if (currentPeer) {
        currentPeer.destroy();
      }
      statusRef.current = "disconnected";
      setRole(null);
    };
  }, [password]);

  const sendData = useCallback((data: any): boolean => {
    if (connRef.current && statusRef.current === "connected") {
      try {
        connRef.current.send(data);
        return true;
      } catch (err) {
        console.error("sendData error:", err);
        return false;
      }
    }
    return false;
  }, []);

  return {
    status,
    error,
    role,
    sendData,
    setOnDataReceived,
  };
}
