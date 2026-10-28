export type Role = "system" | "user" | "assistant" | "tool";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  tools?: { type: "function"; function: { name: string; description?: string; parameters?: object } }[];
  tool_choice?: "auto" | "none" | "required" | object;
  response_format?: { type: "text" | "json_object" };
  /** For models with adjustable reasoning. */
  reasoning_effort?: "low" | "medium" | "high";
  [extra: string]: unknown;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: { index: number; message: ChatMessage; finish_reason: string | null }[];
  usage?: Usage;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }[];
  usage?: Usage;
}

export type ModelKind = "chat" | "image" | "video";

export interface Model {
  id: string;
  object: "model";
  created?: number;
  owned_by?: string;
  kind: ModelKind;
  /** Price per 1,000 input tokens. */
  input_token_rate: number;
  /** Price per 1,000 output tokens. */
  output_token_rate: number;
  /** Price per generated image. */
  image_output_rate: number;
  /** Price per second of generated video. */
  video_output_rate: number;
}

export interface ModelList {
  object: "list";
  data: Model[];
}

export type AspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
export type Style =
  | "photorealistic" | "cinematic" | "illustration" | "anime" | "3d"
  | "watercolor" | "line-art" | "pixel-art" | "isometric" | "minimal";

export interface ImageGenerateParams {
  model: string;
  prompt: string;
  /** 1 to 4. */
  n?: number;
  aspect_ratio?: AspectRatio;
  /** e.g. "1024x1024"; ignored when aspect_ratio is set. */
  size?: string;
  quality?: "standard" | "high" | "ultra";
  style?: Style;
  /** Reference image(s) as data URL / base64 (generation with references). */
  image?: string;
  images?: string[];
  [extra: string]: unknown;
}

/** Binary input accepted by edit/video endpoints. */
export type FileInput = Blob | { data: Blob | Uint8Array | ArrayBuffer; filename?: string };

export interface ImageEditParams {
  model: string;
  prompt: string;
  /** One to four reference images, 10 MB each. */
  image: FileInput | FileInput[];
  aspect_ratio?: AspectRatio;
  quality?: "standard" | "high" | "ultra";
  style?: Style;
  n?: number;
  size?: string;
  [extra: string]: unknown;
}

export interface ImageResponse {
  created: number;
  /** Images are returned base64-encoded; there is no `url`. */
  data: { b64_json: string }[];
}

export type VideoStatus = "queued" | "in_progress" | "completed" | "failed";

export interface Video {
  id: string;
  object: "video";
  model: string;
  status: VideoStatus;
  progress: number;
  created_at: number;
  completed_at: number | null;
  expires_at: number | null;
  seconds: string;
  size: string;
  error: { code: string; message: string } | null;
  prompt?: string;
  aspect_ratio?: string;
  resolution?: string;
  style?: string | null;
  has_reference?: boolean;
  expired?: boolean;
  remixed_from_video_id?: string | null;
}

export interface VideoCreateParams {
  model: string;
  prompt: string;
  /** 4 to 8. Default 8. */
  seconds?: string | number;
  size?: "1280x720" | "720x1280" | "1920x1080" | "1080x1920";
  aspect_ratio?: "16:9" | "9:16";
  resolution?: "720p" | "1080p";
  negative_prompt?: string;
  style?: Style;
  /** Starting frame as data URL / base64 (JSON request). */
  image?: string;
  /** Starting frame as a file (multipart request). */
  input_reference?: FileInput;
  [extra: string]: unknown;
}

export interface VideoListParams {
  limit?: number;
  after?: string;
  order?: "asc" | "desc";
}

export interface VideoList {
  object: "list";
  data: Video[];
  [extra: string]: unknown;
}
