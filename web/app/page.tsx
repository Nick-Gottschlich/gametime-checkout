import { Suspense } from "react";
import { StartCheckoutButton } from "@/components/StartCheckoutButton";
import { formatCents } from "@/lib/format";
import { fetchListings } from "@/lib/server-api";

export default function HomePage() {
  return (
    <main className="page">
      <h1>Pick your tickets</h1>
      <p className="muted">Starting checkout holds the tickets and opens the side-by-side desktop + phone demo.</p>
      <Suspense fallback={<p className="muted">Loading listings…</p>}>
        <Listings />
      </Suspense>
    </main>
  );
}

async function Listings() {
  const listings = await fetchListings();
  if (listings.length === 0) {
    return <p className="muted">Everything sold. Restart the API server to reset the demo.</p>;
  }

  return (
    <ul className="listings">
      {listings.map((listing) => (
        <li key={listing.id} className="card">
          <div>
            <strong>{listing.eventName}</strong>
            <p className="muted">
              Section {listing.section} · Row {listing.row} · {listing.quantity} tickets
            </p>
          </div>
          <div className="card__end">
            <span className="price">{formatCents(listing.priceCents)}</span>
            <StartCheckoutButton listingId={listing.id} />
          </div>
        </li>
      ))}
    </ul>
  );
}
