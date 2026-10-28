# @robiai/sdk

TypeScript SDK for the Robi API (`https://api.robiai.com/v1`, OpenAI-compatible). Zero runtime dependencies; Node 18+, browsers, edge.

```bash
npm install @robiai/sdk
```
```ts
import Robi from "@robiai/sdk";
const robi = new Robi(); // ROBI_API_KEY (keys look like sk-...)

// Chat (models: lexa-mml, lexa-x1, lime, vera)
const r = await robi.chat.completions.create({
  model: "lexa-mml",
  messages: [{ role: "user", content: "Explain caching in one sentence." }],
});
console.log(r.choices[0].message.content);

// Streaming (final chunk has usage + empty choices; mid-stream errors throw APIError)
for await (const c of await robi.chat.completions.create({ model: "lexa-mml", messages: [...], stream: true })) {
  process.stdout.write(c.choices[0]?.delta?.content ?? "");
}

// Vision: content parts
await robi.chat.completions.create({ model: "lexa-mml", messages: [{ role: "user", content: [
  { type: "text", text: "What is in this picture?" },
  { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
]}]});

// Images (b64_json only)
const img = await robi.images.generate({ model: "prism", prompt: "A red bicycle, golden hour", aspect_ratio: "4:5", style: "photorealistic" });
fs.writeFileSync("out.jpg", Buffer.from(img.data[0].b64_json, "base64"));
await robi.images.edit({ model: "prism", prompt: "Studio backdrop", image: new Blob([fs.readFileSync("photo.jpg")]) });

// Video (async job; clips kept 24h)
const v = await robi.videos.createAndPoll({ model: "reel", prompt: "A bicycle rolling past a wall", seconds: 8, size: "1280x720" });
fs.writeFileSync("out.mp4", await robi.videos.downloadContent(v.id));

await robi.models.list(); // includes kind and rates
```
Errors: `BadRequestError`, `AuthenticationError`, `PaymentRequiredError` (402), `PermissionDeniedError`, `RateLimitError`, ... all extend `APIError` with `status`, `code`, `type`, `requestId`. Only 429 and 5xx are retried.
Options: `apiKey`, `baseURL`, `maxRetries`, `timeout`, `fetch`, `defaultHeaders`; per call `{ signal }`.
Dev: `npm install && npm test`.
