import { latestPerStation } from "@/lib/metar";

/**
 * Current weather for a batch of stations.
 */

const UPSTREAM = "https://aviationweather.gov/api/data/metar";

/**
 * How far back to ask.
 *
 * Without an explicit window the API only returns stations that reported inside
 * the last hour, and answers 204 No Content for everything else. Small general-aviation
 * fields report late or hourly, so the default silently excludes exactly the airports
 * this app is for. Three hours covers them; staleness is then reported from the
 * observation time rather than hidden by the query.
 */
const LOOKBACK_HOURS = 3;

const MAX_STATIONS = 120;

const TIMEOUT_MS = 8000;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids");
  if (!raw || raw.trim() === "") {
    return Response.json({ error: "ids is required" }, { status: 400 });
  }

  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim().toUpperCase())
        // ICAO identifiers only — the weather network keys on them, and most
        // small US fields have an FAA code instead and simply do not report.
        .filter((id) => /^[A-Z0-9]{4}$/.test(id)),
    ),
  ]
    .sort()
    .slice(0, MAX_STATIONS);

  if (ids.length === 0) {
    return Response.json({ observations: [], fetchedAt: Date.now() });
  }

  try {
    const response = await fetch(
      `${UPSTREAM}?ids=${ids.join(",")}&format=json&hours=${LOOKBACK_HOURS}`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/json" },
        next: { revalidate: 120 },
      },
    );

    if (!response.ok) {
      return Response.json(
        { error: `weather service returned ${response.status}` },
        { status: 502 },
      );
    }

    const observations =
      response.status === 204 ? [] : latestPerStation(await response.json());

    return Response.json(
      { observations, fetchedAt: Date.now() },
      { headers: { "cache-control": "public, max-age=60" } },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return Response.json(
      { error: timedOut ? "weather service timed out" : "weather service unreachable" },
      { status: 504 },
    );
  }
}
