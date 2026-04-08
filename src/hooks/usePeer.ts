import { useState, useEffect, useCallback, useRef } from "react";
import Peer, { DataConnection } from "peerjs";
import { hashString } from "../lib/crypto";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export function usePeer(password: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  // A callback to pass received raw data up to the UI layer
  const onDataReceivedRef = useRef<(data: any) => void>();

  const setOnDataReceived = useCallback((cb: (data: any) => void) => {
    onDataReceivedRef.current = cb;
  }, []);

  const setupConnection = (conn: DataConnection) => {
    connRef.current = conn;

    conn.on("open", () => {
      setStatus("connected");
      setError(null);
    });

    conn.on("data", (data) => {
      if (onDataReceivedRef.current) {
        onDataReceivedRef.current(data);
      }
    });

    conn.on("close", () => {
      setStatus("disconnected");
      connRef.current = null;
      // If we are B, we should try to reconnect to A
      // We'll handle this via a general reconnect mechanism or let the user refresh
    });

    conn.on("error", (err) => {
      console.error("Connection error:", err);
      setStatus("error");
      setError(err.message);
    });
  };

  useEffect(() => {
    if (!password) return;

    let isMounted = true;
    let currentPeer: Peer | null = null;

    const initPeer = async () => {
      setStatus("connecting");
      try {
        const hash = await hashString(password);
        const baseId = hash.substring(0, 16);
        const peerIdA = `sc-${baseId}-A`;
        const peerIdB = `sc-${baseId}-B`;

        // Try to become Peer A
        const peerA = new Peer(peerIdA, {
          debug: 2,
        });

        peerA.on("open", (id) => {
          if (!isMounted) return;
          console.log("Opened as Peer A:", id);
          currentPeer = peerA;
          peerRef.current = peerA;
          // We are A, wait for B to connect
          setStatus("disconnected"); // Waiting for connection
        });

        peerA.on("connection", (conn) => {
          if (!isMounted) return;
          console.log("Incoming connection from:", conn.peer);
          setupConnection(conn);
        });

        peerA.on("error", (err: any) => {
          if (!isMounted) return;

          if (err.type === "unavailable-id") {
            console.log("Peer A is taken, trying to become Peer B...");
            // Peer A is taken, become Peer B
            peerA.destroy();

            const peerB = new Peer(peerIdB, {
              debug: 2,
            });

            peerB.on("open", (id) => {
              if (!isMounted) return;
              console.log("Opened as Peer B:", id);
              currentPeer = peerB;
              peerRef.current = peerB;

              // Connect to Peer A
              console.log("Connecting to Peer A...");
              const conn = peerB.connect(peerIdA, { reliable: true });
              setupConnection(conn);
            });

            peerB.on("error", (errB) => {
              console.error("Peer B error:", errB);
              setStatus("error");
              setError(errB.message);
            });
          } else {
            console.error("Peer A error:", err);
            setStatus("error");
            setError(err.message);
          }
        });
      } catch (err: any) {
        console.error("Init error:", err);
        setStatus("error");
        setError(err.message);
      }
    };

    initPeer();

    return () => {
      isMounted = false;
      if (connRef.current) {
        connRef.current.close();
      }
      if (currentPeer) {
        currentPeer.destroy();
      }
    };
  }, [password]);

  const sendData = useCallback(
    (data: any) => {
      if (connRef.current && status === "connected") {
        connRef.current.send(data);
        return true;
      }
      return false;
    },
    [status],
  );

  return {
    status,
    error,
    sendData,
    setOnDataReceived,
  };
}
