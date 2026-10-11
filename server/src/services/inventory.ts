import type { Listing } from '../types.js';

// Stand-in for Gametime's real inventory system, which owns whether tickets are
// available, held, or sold. Checkout only asks it questions.
export interface InventoryService {
  /** Current listing details, or null if it was sold elsewhere or pulled. */
  getListing(listingId: string): Promise<Listing | null>;
  /** Reserve the listing for one checkout session. False if another session holds it. */
  hold(listingId: string, sessionId: string): Promise<boolean>;
  release(listingId: string, sessionId: string): Promise<void>;
  markSold(listingId: string): Promise<void>;
}

export class FakeInventoryService implements InventoryService {
  private listings = new Map<string, Listing>();
  private holds = new Map<string, string>(); // listingId -> sessionId holding it

  constructor(listings: Listing[]) {
    for (const listing of listings) this.listings.set(listing.id, { ...listing });
  }

  async getListing(listingId: string) {
    const listing = this.listings.get(listingId);
    return listing ? { ...listing } : null;
  }

  async hold(listingId: string, sessionId: string) {
    if (!this.listings.has(listingId)) return false;
    const holder = this.holds.get(listingId);
    if (holder && holder !== sessionId) return false;
    this.holds.set(listingId, sessionId);
    return true;
  }

  async release(listingId: string, sessionId: string) {
    if (this.holds.get(listingId) === sessionId) this.holds.delete(listingId);
  }

  async markSold(listingId: string) {
    this.listings.delete(listingId);
    this.holds.delete(listingId);
  }

  // --- Controls for tests and the demo ---

  /** Everything still for sale, for the demo's listing picker. */
  allListings(): Listing[] {
    return [...this.listings.values()].map((listing) => ({ ...listing }));
  }

  setPrice(listingId: string, priceCents: number) {
    const listing = this.listings.get(listingId);
    if (listing) listing.priceCents = priceCents;
  }

  /** Simulates the listing selling elsewhere or the seller pulling it. */
  remove(listingId: string) {
    this.listings.delete(listingId);
  }
}
