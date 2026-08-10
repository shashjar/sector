import { MAX_QUERY_RADIUS_NM, normalizeResponse } from "@/lib/adsb";

/**
 * Live traffic for a point and radius.
 *
 * A proxy rather than a direct browser call, for three reasons: adsb.lol sets
 * no CORS headers, the response shape is normalised here so the client never
 * sees upstream field names, and putting the upstream behind our own route
 * means swapping providers never touches the client.
 *
 * Deliberately uncached. Aircraft positions are stale within seconds, and a
 * cached traffic picture is worse than no traffic picture — it shows aircraft
 * where they are not.
 */

const UPSTREAM = "https://api.adsb.lol/v2/point";

/** Upstream is community-run; a slow response should fail rather than hang the poll. */
const TIMEOUT_MS = 8000;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  /**
   * Missing params must be rejected before conversion.
   *
   * `Number(null)` is 0, and 0 is finite — so a bare `Number(params.get(...))`
   * turns a request with no arguments at all into a valid query for latitude 0,
   * longitude 0, which is open ocean off West Africa. It returns 200 and an
   * empty list, and looks exactly like quiet airspace.
   */
  const read = (name: string): number | null => {
    const raw = params.get(name);
    if (raw === null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const lat = read("lat");
  const lon = read("lon");
  const radius = read("radius");

  if (lat === null || lon === null || radius === null) {
    return Response.json(
      { error: "lat, lon and radius are required and must be numbers" },
      { status: 400 },
    );
  }
  if (radius <= 0) {
    return Response.json({ error: "radius must be positive" }, { status: 400 });
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "coordinates out of range" }, { status: 400 });
  }
  if (radius > MAX_QUERY_RADIUS_NM) {
    // The client suppresses the query past this, so reaching here means a
    // hand-built request. Say why rather than passing a doomed call upstream.
    return Response.json(
      {
        error: `radius exceeds ${MAX_QUERY_RADIUS_NM} nm`,
        maxRadiusNm: MAX_QUERY_RADIUS_NM,
      },
      { status: 400 },
    );
  }

  // The upstream takes whole nautical miles and rejects a radius below 1.
  const queryRadius = Math.max(1, Math.min(Math.ceil(radius), MAX_QUERY_RADIUS_NM));

  try {
    const response = await fetch(
      `${UPSTREAM}/${lat.toFixed(5)}/${lon.toFixed(5)}/${queryRadius}`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/json" },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return Response.json(
        { error: `traffic feed returned ${response.status}` },
        { status: 502 },
      );
    }

    const aircraft = normalizeResponse(await response.json());
    return Response.json(
      { aircraft, fetchedAt: Date.now() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // A timeout and a network failure are the same thing to the client: the
    // feed is unreachable and the last known picture should be kept.
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return Response.json(
      { error: timedOut ? "traffic feed timed out" : "traffic feed unreachable" },
      { status: 504 },
    );
  }
}
