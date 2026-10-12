import "server-only";
import type { Listing, SessionResponse } from "./types";

// Server components call the API directly. The browser goes through the /api rewrite instead.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function fetchSession(id: string): Promise<SessionResponse> {
  const res = await fetch(`${API_URL}/sessions/${encodeURIComponent(id)}`);
  return res.json();
}

export async function fetchListings(): Promise<Listing[]> {
  const res = await fetch(`${API_URL}/demo/listings`);
  const body: { listings: Listing[] } = await res.json();
  return body.listings;
}
