import { test } from "node:test";
import assert from "node:assert/strict";
import { Robi, AuthenticationError, RateLimitError, BadRequestError, PaymentRequiredError, VideoFailedError } from "../src/index.js";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("chat completion sends auth and parses response", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const robi = new Robi({
    apiKey: "k", baseURL: "http://x/v1",
    fetch: (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return json({ id: "1", object: "chat.completion", created: 0, model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] });
    }) as typeof fetch,
  });
  const r = await robi.chat.completions.create({ model: "m", messages: [{ role: "user", content: "yo" }] });
  assert.equal(r.choices[0].message.content, "hi");
  assert.equal(seen!.url, "http://x/v1/chat/completions");
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer k");
});

test("streaming yields chunks until [DONE]", async () => {
  const sse = (s: string) => new Response(s, { headers: { "content-type": "text/event-stream" } });
  const chunk = (t: string) => `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: t }, finish_reason: null }] })}\n\n`;
  const robi = new Robi({ apiKey: "k", fetch: (async () => sse(chunk("a") + chunk("b") + "data: [DONE]\n\n")) as typeof fetch });
  assert.equal(await robi.chat.completions.text({ model: "m", messages: [] }), "ab");
});

test("retries on 429 then succeeds; maps 401", async () => {
  let n = 0;
  const robi = new Robi({
    apiKey: "k", maxRetries: 1,
    fetch: (async () => (++n === 1 ? json({ error: { message: "slow" } }, 429, { "retry-after": "0" }) : json({ object: "list", data: [] }))) as typeof fetch,
  });
  assert.deepEqual((await robi.models.list()).data, []);
  assert.equal(n, 2);

  const bad = new Robi({ apiKey: "k", maxRetries: 0, fetch: (async () => json({ error: { message: "nope" } }, 401)) as typeof fetch });
  await assert.rejects(bad.models.list(), AuthenticationError);
  const rl = new Robi({ apiKey: "k", maxRetries: 0, fetch: (async () => json({}, 429)) as typeof fetch });
  await assert.rejects(rl.models.list(), RateLimitError);
});

test("detail errors: string, object code, 402 not retried", async () => {
  let n = 0;
  const robi = new Robi({ apiKey: "k", fetch: (async () => { n++; return json({ detail: { message: "gone", type: "model_deprecated", code: "model_deprecated" } }, 400); }) as typeof fetch });
  await assert.rejects(robi.models.list(), (e: any) => e instanceof BadRequestError && e.code === "model_deprecated" && e.message === "gone");
  const pay = new Robi({ apiKey: "k", fetch: (async () => { n++; return json({ detail: "Insufficient credits" }, 402); }) as typeof fetch });
  await assert.rejects(pay.models.list(), (e: any) => e instanceof PaymentRequiredError && e.message === "Insufficient credits");
  assert.equal(n, 2);
});

test("mid-stream error event throws", async () => {
  const body = 'data: {"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":null}]}\n\ndata: {"error":{"message":"Monthly spend limit reached","type":"upstream_error","code":402}}\n\ndata: [DONE]\n\n';
  const robi = new Robi({ apiKey: "k", fetch: (async () => new Response(body)) as typeof fetch });
  await assert.rejects(robi.chat.completions.text({ model: "m", messages: [] }), (e: any) => e.status === 402);
});

test("images: generate json, edit multipart", async () => {
  const seen: { url: string; body: unknown }[] = [];
  const robi = new Robi({ apiKey: "k", fetch: (async (url: string, init: RequestInit) => { seen.push({ url, body: init.body }); return json({ created: 1, data: [{ b64_json: "AAAA" }] }); }) as typeof fetch });
  const g = await robi.images.generate({ model: "prism", prompt: "bike", n: 1 });
  assert.equal(g.data[0].b64_json, "AAAA");
  await robi.images.edit({ model: "prism", prompt: "bg", image: { data: new Uint8Array([1, 2]), filename: "a.jpg" }, aspect_ratio: "4:5" });
  assert.ok(seen[1].body instanceof FormData);
  assert.equal((seen[1].body as FormData).get("aspect_ratio"), "4:5");
  assert.ok((seen[1].body as FormData).get("image") instanceof Blob);
});

test("videos: createAndPoll completes; failure throws", async () => {
  const vid = (status: string, error: unknown = null) => json({ id: "video_1", object: "video", model: "reel", status, progress: 0, created_at: 0, completed_at: null, expires_at: null, seconds: "8", size: "1280x720", error });
  const seq = [vid("queued"), vid("in_progress"), vid("completed")];
  const robi = new Robi({ apiKey: "k", fetch: (async () => seq.shift()!) as typeof fetch });
  assert.equal((await robi.videos.createAndPoll({ model: "reel", prompt: "p" }, { interval: 1 })).status, "completed");

  const seq2 = [vid("queued"), vid("failed", { code: "audio_filtered", message: "x" })];
  const bad = new Robi({ apiKey: "k", fetch: (async () => seq2.shift()!) as typeof fetch });
  await assert.rejects(bad.videos.createAndPoll({ model: "reel", prompt: "p" }, { interval: 1 }), VideoFailedError);
});
