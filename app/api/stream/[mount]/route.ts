import { findFeed } from "@/lib/feeds";

/**
 * Proxy a LiveATC feed.
 */

const UPSTREAM = "http://d.liveatc.net";
const USER_AGENT = "Sector/0.1 (non-commercial personal project; +https://sector-sandy.vercel.app)";

export const maxDuration = 300;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mount: string }> },
) {
  const { mount } = await params;
  const feed = findFeed(mount);

  if (!feed) {
    return Response.json({ error: "unknown feed" }, { status: 404 });
  }

  try {
    const upstream = await fetch(`${UPSTREAM}/${feed.mount}`, {
      headers: { "user-agent": USER_AGENT },
      // Hand the client's abort straight through. Without this a listener who
      // closes the tab leaves us holding an upstream connection — and LiveATC
      // caps concurrent connections per feed, so leaking them takes slots away
      // from other listeners.
      signal: request.signal,
      cache: "no-store",
      redirect: "follow",
    });

    if (!upstream.ok || !upstream.body) {
      // A listed feed answering 404 is offline, not broken. Volunteer receivers
      // go down, and the interface says so rather than reporting a failure.
      return Response.json(
        { error: "feed offline", mount: feed.mount, label: feed.label },
        { status: 503 },
      );
    }

    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
        "cache-control": "no-store",
        // Surfaced so the client can show what LiveATC calls this receiver
        // rather than only what our catalog calls it.
        "x-feed-label": upstream.headers.get("icy-name") ?? feed.label,
      },
    });
  } catch (error) {
    // The client going away aborts the upstream fetch; that is the normal end
    // of a stream, not a failure worth reporting.
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    return Response.json({ error: "feed unreachable" }, { status: 502 });
  }
}
