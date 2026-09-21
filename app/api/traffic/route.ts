import { MAX_QUERY_RADIUS_NM, normalizeResponse } from "@/lib/adsb";
import { retryAfterMs } from "@/lib/trafficRetry";

/**
 * Live traffic for a point and radius.
 */

const UPSTREAM = "https://api.adsb.lol/v2/point";
const TIMEOUT_MS = 8000;
const CACHE_MS = 5000;
const MIN_REQUEST_INTERVAL_MS = 1000;
const INITIAL_BACKOFF_MS = 30_000;

// Shared by requests in this server process, including different tabs. This
// is not a distributed quota across serverless instances or deployments.
const cache = new Map<string, { aircraft: ReturnType<typeof normalizeResponse>; fetchedAt: number }>();
let pending: { url: string; response: Promise<Response> } | null = null;
let nextRequestAt = 0;
let cooldownUntil = 0;
let backoffMs = INITIAL_BACKOFF_MS;

function rateLimited(until: number) {
  return Response.json(
    { error: "traffic feed rate limited" },
    {
      status: 429,
      headers: {
        "retry-after": String(Math.max(1, Math.ceil((until - Date.now()) / 1000))),
        "cache-control": "no-store",
      },
    },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

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
  const url = `${UPSTREAM}/${lat.toFixed(5)}/${lon.toFixed(5)}/${queryRadius}`;
  const now = Date.now();

  for (const [key, picture] of cache) {
    if (now - picture.fetchedAt >= CACHE_MS) cache.delete(key);
  }
  const picture = cache.get(url);
  if (picture) {
    // Preserve the observation timestamp so cached positions still age out.
    return Response.json(picture, { headers: { "cache-control": "no-store" } });
  }
  if (now < cooldownUntil) return rateLimited(cooldownUntil);
  if (pending?.url === url) return (await pending.response).clone();
  if (pending || now < nextRequestAt) return rateLimited(Math.max(nextRequestAt, now + 1000));

  nextRequestAt = now + MIN_REQUEST_INTERVAL_MS;
  const response = fetchTraffic(url);
  pending = { url, response };
  try {
    return (await response).clone();
  } finally {
    pending = null;
  }
}

async function fetchTraffic(url: string) {
  try {
    const response = await fetch(
      url,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: "application/json",
          "user-agent": "Sector/0.1",
        },
        cache: "no-store",
      },
    );

    if (response.status === 429) {
      const delay = retryAfterMs(response.headers.get("retry-after"), backoffMs);
      cooldownUntil = Date.now() + delay;
      backoffMs = Math.min(backoffMs * 2, 5 * 60_000);
      return rateLimited(cooldownUntil);
    }

    if (!response.ok) {
      return Response.json(
        { error: `traffic feed returned ${response.status}` },
        { status: 502 },
      );
    }

    const aircraft = normalizeResponse(await response.json());
    const picture = { aircraft, fetchedAt: Date.now() };
    backoffMs = INITIAL_BACKOFF_MS;
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(url, picture);
    return Response.json(
      picture,
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
