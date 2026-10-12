// Stand-in for a real analytics pipeline. Every event carries sessionId + surface, which is
// what lets us measure cross-surface continuity: sessions created on one surface and
// completed on another, and where in the state machine fans drop off. See the README.
export function track(event: string, props: { sessionId?: string; surface?: string; [key: string]: unknown }) {
  console.info(`[analytics] ${event}`, props);
}
