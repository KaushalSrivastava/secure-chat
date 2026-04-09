/**
 * Minimal Nostr protocol helpers.
 * Uses ONLY @noble/secp256k1 (Schnorr signing) + browser crypto.subtle (sha256, pbkdf2).
 * No @noble/hashes subpath imports needed.
 */
import { schnorr } from "@noble/secp256k1";

// ---------- helpers ----------

export const bytesToHex = (b: Uint8Array): string =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

// ---------- SHA-256 via crypto.subtle ----------

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // @ts-ignore: TS mismatch between Node/DOM BufferSource types
  const buf = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(buf);
}

// ---------- key derivation ----------

/**
 * Deterministically derive a valid secp256k1 private key from a password
 * using the browser's native PBKDF2 (100k rounds, SHA-256, 32 bytes).
 */
export async function derivePrivKey(password: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode("nostr-sc-v1"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export function getPublicKey(privKey: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(privKey));
}

// ---------- event ----------

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Create and Schnorr-sign a Nostr kind-1 event. */
export async function createEvent(
  content: string,
  tags: string[][],
  privKey: Uint8Array,
): Promise<NostrEvent> {
  const pubkey = getPublicKey(privKey);
  const created_at = Math.floor(Date.now() / 1000);
  const serialized = JSON.stringify([0, pubkey, created_at, 1, tags, content]);
  const hash = await sha256(new TextEncoder().encode(serialized));
  const id = bytesToHex(hash);
  const sig = bytesToHex(await schnorr.signAsync(hash, privKey));
  return { id, pubkey, created_at, kind: 1, tags, content, sig };
}

// ---------- relay wire helpers ----------

export const nostrSub = (subId: string, filter: object): string =>
  JSON.stringify(["REQ", subId, filter]);

export const nostrClose = (subId: string): string =>
  JSON.stringify(["CLOSE", subId]);

export const nostrPublish = (event: NostrEvent): string =>
  JSON.stringify(["EVENT", event]);
