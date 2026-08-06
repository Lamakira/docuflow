/**
 * In-memory stand-in for the `openai` package (ADR-0018: fakes only).
 *
 * `vitest.config.ts` aliases `openai` here, so `server/embeddings.ts` and the
 * chat/transcription routes in `server/routes.ts` build a client from this module.
 *
 * Embeddings are deterministic bag-of-words vectors: the same text always yields
 * the same vector, and texts sharing words land near each other under cosine
 * distance. That keeps pgvector similarity ordering meaningful without a network
 * call, so retrieval-shaped behavior stays characterizable.
 */

const DIMENSIONS = 1536;

export interface RecordedChatCall {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

const recordedEmbeddingInputs: string[][] = [];
const recordedChatCalls: RecordedChatCall[] = [];
const recordedTranscriptionCount = { value: 0 };

/** Canned assistant reply; tests may override it to assert pass-through. */
let chatReply = "This is a fake assistant reply.";
/** Canned Whisper transcript for `openai.audio.transcriptions.create`. */
let transcriptionText = "fake transcript";

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** Deterministic unit vector: hashed bag of words, L2-normalized. */
function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    vector[hashToken(token) % DIMENSIONS] += 1;
  }
  // A zero vector makes pgvector's cosine distance NaN; anchor empty text instead.
  if (tokens.length === 0) vector[0] = 1;
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => v / norm);
}

export default class OpenAI {
  constructor(_options?: { apiKey?: string }) {}

  embeddings = {
    create: async (params: { input: string | string[] }) => {
      const inputs = Array.isArray(params.input) ? params.input : [params.input];
      recordedEmbeddingInputs.push(inputs);
      return {
        data: inputs.map((text, index) => ({
          index,
          embedding: fakeEmbedding(text),
          object: "embedding" as const,
        })),
      };
    },
  };

  chat = {
    completions: {
      create: async (params: RecordedChatCall) => {
        recordedChatCalls.push(params);
        return {
          choices: [{ index: 0, message: { role: "assistant", content: chatReply } }],
        };
      },
    },
  };

  audio = {
    transcriptions: {
      create: async () => {
        recordedTranscriptionCount.value++;
        return { text: transcriptionText };
      },
    },
  };
}

// ─── Test control surface ───

/** Every batch of texts passed to `embeddings.create`, in call order. */
export function embeddingCalls(): string[][] {
  return recordedEmbeddingInputs;
}

/** Every chat completion request, in call order — the assembled system prompt included. */
export function chatCalls(): RecordedChatCall[] {
  return recordedChatCalls;
}

export function transcriptionCallCount(): number {
  return recordedTranscriptionCount.value;
}

export function setChatReply(reply: string): void {
  chatReply = reply;
}

export function resetOpenAi(): void {
  recordedEmbeddingInputs.length = 0;
  recordedChatCalls.length = 0;
  recordedTranscriptionCount.value = 0;
  chatReply = "This is a fake assistant reply.";
  transcriptionText = "fake transcript";
}
