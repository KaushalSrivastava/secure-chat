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

// STUN: for discovery on same-network connections (fast, no relay)
// TURN: mandatory relay for cross-network/VPN connections
// Using iceTransportPolicy:'relay' below forces TURN always,
// which behaves identically to how the PeerJS signaling WebSocket works.
const ICE_SERVERS: RTCIceServer[] = [
  // STUN (used only when iceTransportPolicy is 'all')
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:openrelay.metered.ca:80" },

  // TURN UDP
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

  // TURN TCP/443 — works through most firewalls (looks like HTTPS)
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

  // TURNS — TURN over TLS (most secure/firewall-friendly)
  {
    urls: "turns:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

// Force relay: skip P2P/STUN path entirely, always go through TURN.
// This is what makes cross-network/VPN connections reliable — same
// principle as the PeerJS signaling WebSocket which is also a relay.
const PEER_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceTransportPolicy: "relay", // <-- KEY: no flaky P2P, always relay
};

const OPEN_TIMEOUT_MS = 15_000; // if channel doesn't open in 15s, surface the error

export function usePeer(password: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<PeerRole>(null);
  const statusRef = useRef<ConnectionStatus>("disconnected");

  const connRef = useRef<DataConnection | null>(null);
  const onDataReceivedRef = useRef<(data: any) => void>();

  const setOnDataReceived = useCallback((cb: (data: any) => void) => {
    onDataReceivedRef.current = cb;
  }, []);

  useEffect(() => {
    if (!password) return;

    let isMounted = true;
    let currentPeer: Peer | null = null;
    let openTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const setStatusSynced = (s: ConnectionStatus) => {
      if (!isMounted) return;
      statusRef.current = s;
      setStatus(s);
    };

    const clearOpenTimeout = () => {
      if (openTimeoutId) {
        clearTimeout(openTimeoutId);
        openTimeoutId = null;
      }
    };

    const setupConnection = (conn: DataConnection) => {
      connRef.current = conn;

      // --- ICE state monitoring via the raw RTCPeerConnection ---
      // PeerJS fires "connection" as soon as SDP signaling is done.
      // The DataChannel only truly opens after ICE finishes.
      // We hook into peerConnection to log ICE progress and detect failure fast.
      const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
      if (pc) {
        pc.oniceconnectionstatechange = () => {
          console.log(
            "[ICE]",
            pc.iceConnectionState,
            "| gathering:",
            pc.iceGatheringState,
          );
          if (pc.iceConnectionState === "failed") {
            clearOpenTimeout();
            if (isMounted)
              setError("ICE failed — TURN relay could not connect. Try again.");
            setStatusSynced("error");
          }
          if (
            pc.iceConnectionState === "connected" ||
            pc.iceConnectionState === "completed"
          ) {
            clearOpenTimeout();
          }
        };
        pc.onicegatheringstatechange = () => {
          console.log("[ICE gathering]", pc.iceGatheringState);
        };
      }

      // 15-second timeout: if the channel doesn't open, the TURN relay failed
      openTimeoutId = setTimeout(() => {
        if (statusRef.current !== "connected" && isMounted) {
          console.warn("[usePeer] DataChannel open timed out after 15s");
          setError(
            "Could not open data channel — TURN relay may be unreachable. Try again.",
          );
          setStatusSynced("error");
        }
      }, OPEN_TIMEOUT_MS);

      const onOpen = () => {
        clearOpenTimeout();
        console.log("[usePeer] DataChannel open with:", conn.peer);
        setStatusSynced("connected");
        setError(null);
      };

      if (conn.open) {
        onOpen();
      } else {
        conn.on("open", onOpen);
      }

      conn.on("data", (data) => {
        onDataReceivedRef.current?.(data);
      });

      conn.on("close", () => {
        clearOpenTimeout();
        console.log("[usePeer] Connection closed");
        setStatusSynced("disconnected");
        connRef.current = null;
      });

      conn.on("error", (err) => {
        clearOpenTimeout();
        console.error("[usePeer] Connection error:", err);
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

        const peerA = new Peer(peerIdA, { debug: 1, config: PEER_CONFIG });

        peerA.on("open", (id) => {
          if (!isMounted) return;
          console.log("[usePeer] Registered as Peer A:", id);
          currentPeer = peerA;
          setRole("A");
          setStatusSynced("waiting");
        });

        peerA.on("connection", (conn) => {
          if (!isMounted) return;
          console.log("[usePeer] Peer B connected:", conn.peer);
          setupConnection(conn);
        });

        peerA.on("error", (err: any) => {
          if (!isMounted) return;

          if (err.type === "unavailable-id") {
            console.log("[usePeer] Peer A slot taken → becoming Peer B");
            peerA.destroy();

            const peerB = new Peer(peerIdB, { debug: 1, config: PEER_CONFIG });

            peerB.on("open", (id) => {
              if (!isMounted) return;
              console.log("[usePeer] Registered as Peer B:", id);
              currentPeer = peerB;
              setRole("B");
              console.log("[usePeer] Dialing Peer A:", peerIdA);
              const conn = peerB.connect(peerIdA, { reliable: true });
              setupConnection(conn);
            });

            peerB.on("error", (errB: any) => {
              if (!isMounted) return;
              console.error("[usePeer] Peer B error:", errB);
              setStatusSynced("error");
              setError(errB.message);
            });
          } else {
            console.error("[usePeer] Peer A error:", err);
            setStatusSynced("error");
            setError(err.message);
          }
        });
      } catch (err: any) {
        if (isMounted) {
          setStatusSynced("error");
          setError(err.message);
        }
      }
    };

    initPeer();

    return () => {
      isMounted = false;
      clearOpenTimeout();
      if (connRef.current) {
        connRef.current.close();
        connRef.current = null;
      }
      if (currentPeer) currentPeer.destroy();
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
        console.error("[usePeer] sendData error:", err);
        return false;
      }
    }
    return false;
  }, []);

  return { status, error, role, sendData, setOnDataReceived };
}
