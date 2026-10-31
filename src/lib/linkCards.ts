import { createContext, type ComponentType } from "react";

/**
 * Links a view draws its own way inside markdown: the chat turns a claude.ai
 * artifact link into a card. Without a provider (the reading view), every
 * link stays a plain link.
 */
export interface LinkCards {
  match: (href: string) => boolean;
  /** `label`: the link's text, the URL itself for a bare link. */
  Card: ComponentType<{ href: string; label: string }>;
}

export const LinkCardsContext = createContext<LinkCards | null>(null);
