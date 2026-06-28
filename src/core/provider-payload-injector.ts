import type { AgentInjectionTransport } from "./types.ts";

export type DaseinProviderPayloadShape = "openai-responses" | "openai-completions";
export type DaseinProviderPayloadCacheMode = "prefix-preserving";
export type DaseinProviderPayloadInjectionReason =
  | "unsupported-payload-shape"
  | "missing-user-message"
  | "unsupported-user-content-shape"
  | "empty-content";

export interface DaseinProviderPayloadInjectionInput {
  payload: unknown;
  content: string;
}

export type DaseinProviderPayloadInjectionResult =
  | {
      changed: true;
      payload: unknown;
      providerShape: DaseinProviderPayloadShape;
      cacheMode: DaseinProviderPayloadCacheMode;
      transport: Extract<AgentInjectionTransport, "providerPayload">;
      content: string;
    }
  | {
      changed: false;
      payload: unknown;
      reason: DaseinProviderPayloadInjectionReason;
    };

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmpty = (value: string): boolean => value.trim().length > 0;
const clone = <T>(value: T): T => structuredClone(value);

const appendTextPart = (
  message: JsonRecord,
  content: string,
  textPartType: "input_text" | "text",
): DaseinProviderPayloadInjectionReason | null => {
  const currentContent = message.content;
  const ambientPart = { type: textPartType, text: content };

  if (typeof currentContent === "string") {
    if (!isNonEmpty(currentContent)) return "unsupported-user-content-shape";
    message.content = [{ type: textPartType, text: currentContent }, ambientPart];
    return null;
  }

  if (!Array.isArray(currentContent)) return "unsupported-user-content-shape";
  message.content = [...currentContent, ambientPart];
  return null;
};

const injectIntoLastUserMessage = (
  messages: unknown[],
  content: string,
  textPartType: "input_text" | "text",
): DaseinProviderPayloadInjectionReason | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "user") continue;
    return appendTextPart(message, content, textPartType);
  }
  return "missing-user-message";
};

export const injectAmbientProviderPayload = (input: DaseinProviderPayloadInjectionInput): DaseinProviderPayloadInjectionResult => {
  if (!isNonEmpty(input.content)) return { changed: false, payload: input.payload, reason: "empty-content" };
  if (!isRecord(input.payload)) return { changed: false, payload: input.payload, reason: "unsupported-payload-shape" };

  if (Array.isArray(input.payload.input)) {
    const payload = clone(input.payload);
    const reason = injectIntoLastUserMessage(payload.input as unknown[], input.content, "input_text");
    return reason === null
      ? {
          changed: true,
          payload,
          providerShape: "openai-responses",
          cacheMode: "prefix-preserving",
          transport: "providerPayload",
          content: input.content,
        }
      : { changed: false, payload: input.payload, reason };
  }

  if (Array.isArray(input.payload.messages)) {
    const payload = clone(input.payload);
    const reason = injectIntoLastUserMessage(payload.messages as unknown[], input.content, "text");
    return reason === null
      ? {
          changed: true,
          payload,
          providerShape: "openai-completions",
          cacheMode: "prefix-preserving",
          transport: "providerPayload",
          content: input.content,
        }
      : { changed: false, payload: input.payload, reason };
  }

  return { changed: false, payload: input.payload, reason: "unsupported-payload-shape" };
};
