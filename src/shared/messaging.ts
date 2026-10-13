import type { Message, MessageResponse } from "./types";

export function sendMessage<T extends MessageResponse = MessageResponse>(
  message: Message,
): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
