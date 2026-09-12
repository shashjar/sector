import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribe } from "ai";
import { POST } from "./route";

vi.mock("ai", () => ({ transcribe: vi.fn() }));

const MAX_BYTES = 2 * 1024 * 1024;

function upload(chunks: Uint8Array[], contentLength?: string) {
  let index = 0;
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  });
  const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
  const request = new Request("http://localhost/api/transcribe", {
    method: "POST",
    body,
    duplex: "half",
    headers: contentLength === undefined ? {} : { "Content-Length": contentLength },
  } as RequestInit);
  return { request, cancel, pull };
}

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.mocked(transcribe).mockResolvedValue({
    text: " hello ",
    durationInSeconds: 1,
  } as Awaited<ReturnType<typeof transcribe>>);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("transcription uploads", () => {
  it("preserves chunk order and passes only the received bytes", async () => {
    const { request } = upload([new Uint8Array([1, 2]), new Uint8Array([3])]);
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: "hello", durationSec: 1 });
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({
      audio: new Uint8Array([1, 2, 3]),
      abortSignal: request.signal,
    }));
    expect(request.body?.locked).toBe(false);
  });

  it("accepts exactly 2 MiB", async () => {
    const { request } = upload([new Uint8Array(MAX_BYTES - 1), new Uint8Array([7])]);
    expect((await POST(request)).status).toBe(200);
    const audio = vi.mocked(transcribe).mock.calls[0][0].audio;
    expect(audio).toBeInstanceOf(Uint8Array);
    expect((audio as Uint8Array).byteLength).toBe(MAX_BYTES);
    expect((audio as Uint8Array)[MAX_BYTES - 1]).toBe(7);
  });

  it.each([undefined, "1"])("cancels on overflow with Content-Length %s", async (length) => {
    const { request, cancel, pull } = upload([
      new Uint8Array(MAX_BYTES),
      new Uint8Array([1]),
      new Uint8Array([2]),
    ], length);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "audio too large" });
    expect(pull).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(request.body?.locked).toBe(false);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects a single oversized chunk even if cancellation fails", async () => {
    const { request, cancel, pull } = upload([new Uint8Array(MAX_BYTES + 1)]);
    cancel.mockRejectedValue(new Error("cancel failed"));
    expect((await POST(request)).status).toBe(413);
    expect(pull).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(request.body?.locked).toBe(false);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it.each([{ chunks: [] }, { chunks: [new Uint8Array(0)] }])("rejects an empty stream (%j)", async ({ chunks }) => {
    const { request } = upload(chunks);
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "empty audio" });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects a missing body", async () => {
    const response = await POST(new Request("http://localhost/api/transcribe", { method: "POST" }));
    expect(response.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("handles an aborted body read and releases the reader", async () => {
    const { request, pull } = upload([]);
    pull.mockImplementation(() => { throw new DOMException("aborted", "AbortError"); });
    expect((await POST(request)).status).toBe(499);
    expect(request.body?.locked).toBe(false);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
