# Vue moderne d'Arkadia — Design

**Date** : 2026-06-16
**Statut** : validé, en implémentation directe (l'utilisateur a délégué l'implémentation)

## But

Un toggle bascule **tous les panneaux** entre le terminal actuel et une **vue moderne** type
« lecture » qui rend **tout** ce que dit Claude — texte, pensées, appels d'outils, résultats —
de façon structurée, filtrable, et bien séparée par message, **tout en gardant le vrai champ de
saisie** de Claude Code en bas (avec toutes ses fonctions : collage d'images, `/`, `@`, plan mode).

## Décisions verrouillées (issues du brainstorming visuel)

1. **Famille A** — la vue moderne lit le transcript JSONL de Claude Code (pas de SDK headless, pas
   de réécriture du harness). Maj **bloc par bloc** (accepté), live via `agent-state-changed`.
2. **Toggle global** — un seul état persisté `modernViewEnabled` ; quand il est ON, *tous* les panes
   rendent la vue moderne. Vit dans la `Toolbar` comme les toggles lecture/notepad.
3. **Disposition A** — vue moderne en haut + **pied entier du vrai terminal rogné** en bas (saisie +
   statusline + mode + tokens + prompts interactifs). **On ne recopie rien.** ExitPlanMode /
   AskUserQuestion / permissions / autocomplétion / collage d'image fonctionnent nativement car
   c'est le vrai terminal ; la zone rognée grandit toute seule.
4. **Rendu des blocs** — bulles par type, code couleur (Toi vert #22c55e · Claude violet #a855f7 ·
   Pensées gris #6b7280 italique · Outils bleu #38bdf8 · Résultats ambre #f59e0b). **Appel d'outil +
   résultat appariés dans une seule carte** (en-tête + sortie repliable). Densité par défaut
   **B (Aperçu)** : en-tête + 2-3 lignes de sortie + « voir plus ». Réglable **A/B/C** dans
   `SettingsDialog` (A = compact 1 ligne, B = aperçu, C = déplié).
5. **Filtres** — icône **entonnoir → popover** de cases (Toi / Claude / Pensées / Outils / Résultats).
   Clic gauche = bascule un type ; **clic droit = solo** (coche celui-là seul) ; reclic droit sur un
   type déjà en solo = restaure tout. Tout visible par défaut.
6. **Suppression** du bouton « focus » (entonnoir `Filter`) du `MessageNavRail` et de tout le câblage
   `focusMessages` (App → PaneTreeView → TerminalWebGPU) — non utilisé.
7. **Flèches de navigation à double comportement** — OFF : comportement actuel (`navigate_message`
   backend, scroll du terminal). ON : saut de bloc en bloc dans la vue moderne (frontend pur).

## Architecture

### Données (Rust)

Nouvelle commande `conversation::read_conversation_blocks(pane_id)` **à côté** de `read_conversation`
(qui reste pour la vue lecture actuelle, intacte — pas de régression). Elle relit le même transcript
mais **conserve** les blocs au lieu de les jeter, et **apparie** `tool_use` ↔ `tool_result` par
`tool_use_id`. Retour : `Vec<ConvBlock>` ordonné, le plus ancien d'abord.

```rust
struct ConvBlock {
  kind: String,               // "user" | "assistant" | "thinking" | "tool"
  text: Option<String>,       // user / assistant / thinking (markdown, nettoyé)
  tool_name: Option<String>,  // tool
  tool_input: Option<String>, // tool — JSON compact de l'input
  tool_output: Option<String>,// tool — contenu du tool_result (texte extrait)
}
```

- `clean_text` (suppression des tags injectés) s'applique aux user/assistant/thinking.
- Appariement : map `tool_use_id -> index` du bloc Tool émis ; le `tool_result` correspondant
  remplit `tool_output`. `tool_result.content` peut être string ou array → extraire le texte.
- Le résumé d'en-tête (`npm test`, `src/store.ts`…) est dérivé **côté front** depuis `tool_input`.

### Vue moderne (React)

- `useConversationBlocks(paneId)` — jumeau de `useConversation` (même listener `agent-state-changed`,
  même refresh), mais via `read_conversation_blocks`.
- `ModernConversationView.tsx` — rend la liste filtrée des blocs ; réutilise `CONVERSATION_CSS` /
  markdown. Cartes d'outil avec densité A/B/C. Expose une API impérative de navigation (saut au
  bloc précédent/suivant de type 1=user / 2=Claude) pour les flèches.
- `FilterPopover` — entonnoir + cases, état des filtres (5 booléens) ; clic droit = solo.
- Filtres + densité par défaut : état dans `App.tsx`, densité persistée via store.

### Intégration layout (le point délicat)

Quand `modernViewEnabled` est ON, dans le conteneur `relative` de chaque leaf de `PaneTreeView` :
le `Terminal`/`TerminalWebGPU` reste **monté et plein cadre** (donc focusable, interactif, le PTY
continue), et on **superpose** `ModernConversationView` en `absolute inset-0` avec un
`bottom: <footerHeightPx>` qui laisse dépasser le pied réel du terminal.

`footerHeightPx` = calculé depuis `pane.screen` :
- déterminer le **haut de la zone de saisie** en remontant depuis le bas tant que les lignes sont
  du chrome / input / option / box (`terminalChrome.ts` : `isChromeRow`, `isInputRow`, `isOptionRow`,
  `isBoxRow`) jusqu'à la première ligne de transcript.
- `footerRows = rows - footerTopRow` ; `footerHeightPx = footerRows * cellHeight + padding`.
- recalculé à chaque nouveau `screen` → la zone grandit automatiquement (ExitPlanMode/AskUserQuestion).
- focus : le terminal garde le focus clavier ; cliquer une carte d'outil (déplier) est une action de
  lecture ; refocus du terminal après. La saisie passe toujours au terminal (footer visible).

### Toolbar / Settings / NavRail

- `Toolbar` : nouveau bouton toggle (icône type `LayoutList`/`SquareStack`), `modernViewEnabled`,
  exclusif avec lecture/notepad si besoin (à vérifier — sinon indépendant).
- `SettingsDialog` : sélecteur densité A/B/C (`toolDensity`).
- `MessageNavRail` : retrait du bouton `Filter` ; les flèches restent. Leur handler (`onNavigate`)
  est aiguillé en amont (`App.tsx`) selon `modernViewEnabled`.

### Persistance (store.ts / types.ts)

- `modernViewEnabled: boolean` (défaut `false`).
- `toolDensity: "compact" | "preview" | "full"` (défaut `"preview"`).
  Mêmes patterns que `messageFramesEnabled` etc. (clé, normalisation `boolOr` / validation enum).

## Phases d'implémentation

1. **Rust** — `read_conversation_blocks` + `ConvBlock` + tests d'appariement ; enregistrer dans
   `lib.rs`. (Aucune régression sur `read_conversation`.)
2. **Store/types** — `modernViewEnabled`, `toolDensity` (load/save/normalize/default).
3. **Suppression `focusMessages`** — App / PaneTreeView / TerminalWebGPU / MessageNavRail.
4. **Vue moderne** — `useConversationBlocks`, `ModernConversationView`, cartes d'outil, `FilterPopover`.
5. **Intégration** — overlay dans PaneTreeView + calcul footer ; toggle Toolbar ; aiguillage des
   flèches ; densité dans Settings.
6. **Vérif** — `npx tsc --noEmit` ; build Tauri ; itération runtime (rognage/footer/scroll live)
   avec l'utilisateur car ces parties s'observent dans l'app lancée.

## Risques / notes

- **Le rognage du footer** est la partie sensible : hauteur dynamique, focus clavier conservé,
  comportement sur les splits (mode global → chaque pane a sa vue moderne + son footer). À itérer
  en conditions réelles (rebuild Tauri requis ; fermer `arkadia.exe` avant rebuild).
- **Live = bloc par bloc** : pendant qu'une réponse longue s'écrit, son texte n'apparaît dans la vue
  moderne qu'une fois le bloc flushé ; le flux mot-à-mot reste visible dans le footer (vrai terminal).
- **Renderer non-WebGPU** (`Terminal`) : l'overlay marche pareil (calcul footer identique). Le
  `focusMessages` n'existait que côté WebGPU ; rien à retirer côté `Terminal`.
