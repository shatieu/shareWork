/**
 * Local-daemon security helpers (plan 03 §4.5, FO-approved posture): the hull binds 127.0.0.1
 * only, rejects requests whose Host header isn't a loopback name (kills DNS rebinding -- a
 * malicious page at attacker.com resolving to 127.0.0.1 sends `Host: attacker.com`), and requires
 * a custom header on state-changing/spawning routes (a cross-origin form/fetch cannot attach a
 * custom header without a CORS preflight, and the hull enables no CORS -- browser-borne CSRF is
 * dead). A real token scheme is future work; any local process can still POST, which is inherent
 * to a local daemon and documented.
 */

/** Custom header every Deck client attaches to mutating/spawning requests. The value is
 * irrelevant (presence is the CSRF proof); clients send '1'. */
export const DECK_CLIENT_HEADER = 'x-ship-deck';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * True when an incoming Host header names this machine's loopback (optionally with the given
 * port). Undefined/empty Host headers are rejected: every real browser and HTTP/1.1 client sends
 * one, and "no Host" is exactly what primitive rebinding/smuggling probes look like.
 */
export function isAllowedHostHeader(hostHeader: string | undefined, port?: number): boolean {
  if (!hostHeader) return false;
  const value = hostHeader.trim().toLowerCase();

  // Split off the port, careful with the bracketed IPv6 loopback form `[::1]:4317`.
  let host = value;
  let portPart: string | undefined;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end === -1) return false;
    host = value.slice(0, end + 1);
    const rest = value.slice(end + 1);
    if (rest.startsWith(':')) portPart = rest.slice(1);
    else if (rest !== '') return false;
  } else {
    const colon = value.lastIndexOf(':');
    if (colon !== -1) {
      host = value.slice(0, colon);
      portPart = value.slice(colon + 1);
    }
  }

  if (!LOOPBACK_HOSTS.has(host)) return false;
  if (portPart !== undefined) {
    if (!/^\d+$/.test(portPart)) return false;
    if (port !== undefined && Number(portPart) !== port) return false;
  }
  return true;
}
