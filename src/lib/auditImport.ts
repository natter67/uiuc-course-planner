// Moving audit text from the browser extension to the planner without a server:
// the extension compresses the text into the URL fragment (#audit=...), which browsers never
// send over the network. The planner reads it once and clears it.

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  const out = input.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeAudit(text: string): Promise<string> {
  return toBase64Url(await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw")));
}

export async function decodeAudit(fragment: string): Promise<string> {
  return new TextDecoder().decode(await pipe(fromBase64Url(fragment), new DecompressionStream("deflate-raw")));
}

/** Returns audit text passed in the URL fragment, and removes it from the address bar. */
export async function takeAuditFromUrl(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const m = /^#audit=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (!m) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    return await decodeAudit(m[1]);
  } catch {
    return null;
  }
}

/** Quick check that pasted text is a uAchieve audit before parsing it. */
export function looksLikeAudit(text: string): boolean {
  return /Requirement:/.test(text) && /(Prepared On|SUMMARY OF COURSES TAKEN|Sub-Requirement)/.test(text);
}
