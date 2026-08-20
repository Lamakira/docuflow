/**
 * Intelligence is a shell in Phase 6. Index-artifact APIs land in #116.
 * This module must not own another module's tables or operational lookup.
 * Chatbot corpus LIKE search lives on Knowledge.
 */
export interface IntelligencePersistence {}

type EmptyShell<T> = [keyof T] extends [never] ? true : never;
export const intelligenceIsShell: EmptyShell<IntelligencePersistence> = true;
