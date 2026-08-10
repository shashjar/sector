/**
 * LiveATC feeds, hand-curated.
 */

export interface Feed {
  /** LiveATC mount name — the path segment on their stream host. */
  mount: string;
  /** Airport identifier, matching the `ident` on airport features. */
  airport: string;
  /** As LiveATC names the feed. */
  label: string;
  /** Which controller positions this receiver carries. */
  positions: string;
}

export const FEEDS: Feed[] = [
  // Bay Area
  { mount: "ksql_twr", airport: "KSQL", label: "KSQL Tower", positions: "Tower" },
  { mount: "ksfo_twr", airport: "KSFO", label: "KSFO Tower", positions: "Tower" },
  { mount: "ksfo_gnd", airport: "KSFO", label: "KSFO Ground", positions: "Ground" },
  { mount: "khwd", airport: "KHWD", label: "KHWD Ground + Tower", positions: "Tower, Ground" },
  { mount: "knuq", airport: "KNUQ", label: "Moffett Federal", positions: "Tower" },
  { mount: "koak", airport: "KOAK", label: "Oakland International", positions: "Tower, Ground" },
  { mount: "kmry", airport: "KMRY", label: "KMRY Ground + Tower", positions: "Tower, Ground" },
  { mount: "ksck", airport: "KSCK", label: "KSCK Ground, Tower, Approach", positions: "Tower, Ground, Approach" },

  // Larger fields, for somewhere busy to listen to
  { mount: "kjfk_twr", airport: "KJFK", label: "KJFK Tower", positions: "Tower" },
  { mount: "klax_twr", airport: "KLAX", label: "KLAX Tower", positions: "Tower" },
  { mount: "katl_twr", airport: "KATL", label: "KATL Tower (scanning)", positions: "Tower" },
  { mount: "kdca", airport: "KDCA", label: "KDCA Washington", positions: "Tower, Ground" },
];

const BY_AIRPORT = new Map<string, Feed[]>();
for (const feed of FEEDS) {
  BY_AIRPORT.set(feed.airport, [...(BY_AIRPORT.get(feed.airport) ?? []), feed]);
}

export function feedsFor(airport: string): Feed[] {
  return BY_AIRPORT.get(airport) ?? [];
}

export function findFeed(mount: string): Feed | undefined {
  return FEEDS.find((feed) => feed.mount === mount);
}

/** Airports with at least one feed, for the headphone badge on the scope. */
export const AIRPORTS_WITH_FEEDS = [...BY_AIRPORT.keys()];

/**
 * The civil VHF air band.
 */
export const VHF_MIN_MHZ = 118;
export const VHF_MAX_MHZ = 137;

export function isAirbandFrequency(mhz: number): boolean {
  return mhz >= VHF_MIN_MHZ && mhz <= VHF_MAX_MHZ;
}
