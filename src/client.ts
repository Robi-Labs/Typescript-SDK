import {
  APIError, ConnectionError, RobiError, TimeoutError, errorFor,
} from "./errors.js";
import type {
  ChatCompletion, ChatCompletionChunk, ChatCompletionParams, FileInput,
  ImageEditParams, ImageGenerateParams, ImageResponse, Model, ModelList,
  Video, VideoCreateParams, VideoList, VideoListParams,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.robiai.com/v1";

export interface RobiOptions {
  /** Defaults to the ROBI_API_KEY environment variable. */
  apiKey?: string;
  /** Defaults to ROBI_BASE_URL, then https://api.robiai.com/v1. */
  baseURL?: string;
  /** Retries on 429/5xx and network errors. Default 2. */
  maxRetries?: number;
  /** Per-request timeout in ms. Default 60000. */
  timeout?: number;
  /** Custom fetch (tests, proxies, React Native). */
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const env = (k: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[k] : undefined;

export class Robi {
  readonly chat: { completions: ChatCompletions };
  readonly images: Images;
  readonly videos: Videos;
  readonly models: Models;

  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly maxRetries: number;
  private readonly timeout: number;
  private readonly _fetch: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  constructor(opts: RobiOptions = {}) {
    const key = opts.apiKey ?? env("ROBI_API_KEY");
    if (!key) throw new RobiError("Missing API key. Pass { apiKey } or set ROBI_API_KEY.");
    this.apiKey = key;
    this.baseURL = (opts.baseURL ?? env("ROBI_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = opts.maxRetries ?? 2;
    this.timeout = opts.timeout ?? 60_000;
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = opts.defaultHeaders ?? {};
    this.chat = { completions: new ChatCompletions(this) };
    this.images = new Images(this);
    this.videos = new Videos(this);
    this.models = new Models(this);
  }

  /** @internal */
  async request(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": "robiai-typescript/0.1.0",
      ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...this.defaultHeaders,
      ...opts.headers,
    };

    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, this.timeout);
      const onAbort = () => ctrl.abort();
      opts.signal?.addEventListener("abort", onAbort);
      try {
        const res = await this._fetch(this.baseURL + path, {
          method, headers, signal: ctrl.signal,
          body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        });
        if (res.ok) return res;
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < this.maxRetries) {
          await sleep(retryDelay(attempt, res.headers.get("retry-after")));
          continue;
        }
        let parsed: unknown;
        try { parsed = await res.json(); } catch { parsed = undefined; }
        throw errorFor(res.status, parsed, res.headers.get("x-request-id"));
      } catch (err) {
        if (err instanceof APIError) throw err;
        if (opts.signal?.aborted) throw err;
        const wrapped = timedOut
          ? new TimeoutError(`Request timed out after ${this.timeout}ms`)
          : new ConnectionError(`Connection error: ${(err as Error).message}`);
        if (attempt < this.maxRetries) { await sleep(retryDelay(attempt, null)); continue; }
        throw wrapped;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      }
    }
  }

  /** @internal */
  async json<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return (await this.request(method, path, body, opts)).json() as Promise<T>;
  }
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const secs = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 30_000);
  return Math.min(500 * 2 ** attempt, 8_000) * (0.75 + Math.random() * 0.25);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse a Server-Sent Events body into chunks until `[DONE]`. */
async function* parseSSE(res: Response): AsyncGenerator<ChatCompletionChunk> {
  if (!res.body) throw new RobiError("Streaming response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
        const data = event.split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") return;
        const parsed = JSON.parse(data) as ChatCompletionChunk & { error?: { message?: string; type?: string; code?: number | string } };
        if (parsed.error) {
          const code = parsed.error.code;
          throw new APIError(parsed.error.message ?? "Stream error", typeof code === "number" ? code : 500, parsed, null, code != null ? String(code) : undefined, parsed.error.type);
        }
        yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class ChatCompletions {
  constructor(private readonly client: Robi) {}

  create(params: ChatCompletionParams & { stream?: false }, opts?: RequestOptions): Promise<ChatCompletion>;
  create(params: ChatCompletionParams & { stream: true }, opts?: RequestOptions): Promise<AsyncGenerator<ChatCompletionChunk>>;
  async create(params: ChatCompletionParams & { stream?: boolean }, opts?: RequestOptions) {
    if (params.stream) {
      const res = await this.client.request("POST", "/chat/completions", params, {
        ...opts, headers: { ...opts?.headers, Accept: "text/event-stream" },
      });
      return parseSSE(res);
    }
    return this.client.json<ChatCompletion>("POST", "/chat/completions", params, opts);
  }

  /** Stream and collect the full text. */
  async text(params: ChatCompletionParams, opts?: RequestOptions): Promise<string> {
    let out = "";
    for await (const c of await this.create({ ...params, stream: true }, opts)) {
      out += c.choices[0]?.delta?.content ?? "";
    }
    return out;
  }
}

export class Models {
  constructor(private readonly client: Robi) {}
  list(opts?: RequestOptions): Promise<ModelList> {
    return this.client.json("GET", "/models", undefined, opts);
  }
  retrieve(id: string, opts?: RequestOptions): Promise<Model> {
    return this.client.json("GET", `/models/${encodeURIComponent(id)}`, undefined, opts);
  }
}

function toBlob(f: FileInput): { blob: Blob; filename?: string } {
  if (f instanceof Blob) return { blob: f, filename: (f as File).name };
  const d = f.data;
  return { blob: d instanceof Blob ? d : new Blob([d as BlobPart]), filename: f.filename };
}

function toForm(fields: Record<string, unknown>, files: Record<string, FileInput | FileInput[]>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.append(k, String(v));
  for (const [k, v] of Object.entries(files))
    for (const f of Array.isArray(v) ? v : [v]) {
      const { blob, filename } = toBlob(f);
      form.append(k, blob, filename ?? "upload");
    }
  return form;
}

export class Images {
  constructor(private readonly client: Robi) {}

  generate(params: ImageGenerateParams, opts?: RequestOptions): Promise<ImageResponse> {
    return this.client.json("POST", "/images/generations", params, opts);
  }

  /** Edit or restyle 1-4 reference images (multipart). Masks are not supported. */
  edit(params: ImageEditParams, opts?: RequestOptions): Promise<ImageResponse> {
    const { image, ...fields } = params;
    return this.client.json("POST", "/images/edits", toForm(fields, { image }), opts);
  }
}

export interface PollOptions extends RequestOptions {
  /** ms between polls. Default 5000. */
  interval?: number;
  /** Give up after this many ms. Default 600000. */
  timeout?: number;
}

export class VideoFailedError extends RobiError {
  constructor(readonly video: Video) {
    super(`Video ${video.id} failed: ${video.error?.code ?? "unknown"}: ${video.error?.message ?? ""}`);
  }
}

export class Videos {
  constructor(private readonly client: Robi) {}

  create(params: VideoCreateParams, opts?: RequestOptions): Promise<Video> {
    const { input_reference, ...rest } = params;
    const body = input_reference ? toForm(rest, { input_reference }) : rest;
    return this.client.json("POST", "/videos", body, opts);
  }

  retrieve(id: string, opts?: RequestOptions): Promise<Video> {
    return this.client.json("GET", `/videos/${encodeURIComponent(id)}`, undefined, opts);
  }

  list(params: VideoListParams = {}, opts?: RequestOptions): Promise<VideoList> {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return this.client.json("GET", `/videos${q.size ? `?${q}` : ""}`, undefined, opts);
  }

  delete(id: string, opts?: RequestOptions): Promise<unknown> {
    return this.client.json("DELETE", `/videos/${encodeURIComponent(id)}`, undefined, opts);
  }

  /** Download the finished MP4 (kept 24h after completion; afterwards 410). */
  async downloadContent(id: string, opts?: RequestOptions): Promise<Uint8Array> {
    const res = await this.client.request("GET", `/videos/${encodeURIComponent(id)}/content`, undefined, {
      ...opts, headers: { ...opts?.headers, Accept: "video/mp4" },
    });
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Create, then poll until completed. Throws VideoFailedError if the job fails. */
  async createAndPoll(params: VideoCreateParams, opts: PollOptions = {}): Promise<Video> {
    let video = await this.create(params, opts);
    const deadline = Date.now() + (opts.timeout ?? 600_000);
    while (video.status === "queued" || video.status === "in_progress") {
      if (Date.now() > deadline) throw new TimeoutError(`Video ${video.id} not finished after ${opts.timeout ?? 600_000}ms`);
      await sleep(opts.interval ?? 5_000);
      video = await this.retrieve(video.id, opts);
    }
    if (video.status === "failed") throw new VideoFailedError(video);
    return video;
  }
}
