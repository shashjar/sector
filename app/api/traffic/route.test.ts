import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let GET: typeof import("./route").GET;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T18:00:00Z"));
  ({ GET } = await import("./route"));
});

const request = () => new Request(
  "http://localhost:3000/api/traffic?lat=37.51313&lon=-122.25084&radius=38",
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("traffic feed", () => {
  it("identifies Sector to the provider and returns moving aircraft for the map", async () => {
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.get("user-agent")?.startsWith("Sector/")) {
        return new Response("User-Agent too generic; include valid contact info.", { status: 403 });
      }
      return Response.json({ ac: [{
        hex: "a857c9", flight: "N637AM  ", lat: 37.447411, lon: -122.467406,
        alt_baro: 13000, gs: 310.3, track: 168.47, seen_pos: 0.331,
      }] });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      aircraft: [{
        id: "a857c9", callsign: "N637AM", lat: 37.447411, lon: -122.467406,
        groundSpeedKt: 310.3, trackDeg: 168.47, positionAgeSec: 0.331,
      }],
      fetchedAt: expect.any(Number),
    });
    expect(upstream).toHaveBeenCalledWith(
      "https://api.adsb.lol/v2/point/37.51313/-122.25084/38",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reports upstream rejection as an error rather than an empty traffic picture", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })));

    const response = await GET(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "traffic feed returned 403" });
  });

  it("shares concurrent requests and cached snapshots without refreshing their age", async () => {
    let resolve!: (response: Response) => void;
    const upstream = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", upstream);
    const first = GET(request());
    const second = GET(request());
    expect(upstream).toHaveBeenCalledOnce();
    resolve(Response.json({ ac: [] }));
    const picture = await (await first).json();
    expect(await (await second).json()).toEqual(picture);

    vi.advanceTimersByTime(4000);
    expect(await (await GET(request())).json()).toEqual(picture);
    expect(upstream).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1000);
    upstream.mockResolvedValue(Response.json({ ac: [] }));
    expect((await (await GET(request())).json()).fetchedAt).toBe(picture.fetchedAt + 5000);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("throttles bursts across different viewports", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ ac: [] }));
    vi.stubGlobal("fetch", upstream);
    await GET(request());
    const other = () => new Request("http://localhost/api/traffic?lat=38&lon=-122&radius=31");
    const limited = await GET(other());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(upstream).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    upstream.mockResolvedValue(Response.json({ ac: [] }));
    expect((await GET(other())).status).toBe(200);
  });

  it.each(["45", "Sat, 12 Sep 2026 18:00:45 GMT"])("honors Retry-After %s across viewports", async (retryAfter) => {
    const upstream = vi.fn().mockResolvedValue(new Response(null, {
      status: 429, headers: { "retry-after": retryAfter },
    }));
    vi.stubGlobal("fetch", upstream);
    const limited = await GET(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("45");
    vi.advanceTimersByTime(5000);
    const other = await GET(new Request("http://localhost/api/traffic?lat=38&lon=-122&radius=31"));
    expect(other.status).toBe(429);
    expect(other.headers.get("retry-after")).toBe("40");
    expect(upstream).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(40_000);
    upstream.mockResolvedValue(Response.json({ ac: [] }));
    expect((await GET(request())).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially without Retry-After and resets after recovery", async () => {
    const upstream = vi.fn().mockImplementation(async () => new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", upstream);
    expect((await GET(request())).headers.get("retry-after")).toBe("30");
    vi.advanceTimersByTime(30_000);
    expect((await GET(request())).headers.get("retry-after")).toBe("60");
    vi.advanceTimersByTime(60_000);
    upstream.mockResolvedValueOnce(Response.json({ ac: [] }));
    expect((await GET(request())).status).toBe(200);
    vi.advanceTimersByTime(5000);
    expect((await GET(request())).headers.get("retry-after")).toBe("30");
  });

  it("releases the pending request after network failures", async () => {
    const upstream = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", upstream);
    expect((await GET(request())).status).toBe(504);
    vi.advanceTimersByTime(5000);
    upstream.mockResolvedValue(Response.json({ ac: [] }));
    expect((await GET(request())).status).toBe(200);
  });
});
