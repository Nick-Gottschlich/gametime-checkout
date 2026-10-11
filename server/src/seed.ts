import type { Listing } from './types.js';

// Listings the demo can sell. Stand-ins for what Gametime's real inventory would return.
export const DEMO_LISTINGS: Listing[] = [
  { id: 'gsw-lal-112', eventName: 'Warriors vs. Lakers', section: '112', row: 'F', quantity: 2, priceCents: 15000 },
  { id: 'sf-lad-lower', eventName: 'Giants vs. Dodgers', section: 'LB 118', row: '22', quantity: 4, priceCents: 6500 },
  { id: 'olivia-floor', eventName: 'Olivia Rodrigo', section: 'Floor B', row: '9', quantity: 2, priceCents: 32000 },
];
