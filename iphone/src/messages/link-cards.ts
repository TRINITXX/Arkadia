import { createContext, type ComponentType } from "react";

/**
 * Links a view draws its own way inside markdown, as the desktop's
 * `LinkCardsContext` (`@/lib/linkCards`): the chat's artifact links and the
 * user's pasted texts as cards. Without a provider (the Messages tab, the
 * desktop's reading view), every link stays a link. The app's own context:
 * the shared one is typed by the desktop's React, not the app's.
 */
export interface LinkCards {
  match: (href: string) => boolean;
  /** `label`: the link's text, the address itself for a bare one. */
  Card: ComponentType<{ href: string; label: string }>;
}

export const LinkCardsContext = createContext<LinkCards | null>(null);
