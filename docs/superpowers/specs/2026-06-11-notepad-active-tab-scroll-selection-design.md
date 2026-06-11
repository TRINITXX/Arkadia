# Design — Bloc-note latéral, bascule auto onglet Active, sélection ancrée au scrollback

Date : 2026-06-11
Statut : validé par Alexis (panneau latéral ouvert par une icône toolbar, historique par projet, bascule à chaque transition, comportement sélection standard complet avec auto-scroll au bord).

## 1. Bloc-note latéral (icône toolbar)

### Objectif

Un panneau intégré pour rédiger des prompts, les copier au presse-papier, et retrouver l'historique des messages précédents après fermeture/réouverture (du panneau ou de l'app).

### UI / Layout

- Nouveau composant `src/components/NotepadPanel.tsx`, monté dans `App.tsx` **dans le flex row principal**, à droite de la zone terminal.
- Largeur par défaut ~320 px, **redimensionnable** par une poignée de drag sur le bord gauche du panneau (min 240 px, max 600 px). La largeur choisie est persistée dans `notepad.json` (clé globale `panelWidth`, indépendante du projet).
- Le terminal s'adapte : il ne doit **jamais être recouvert** — le panneau prend sa place dans le layout et le terminal rétrécit. Le `ResizeObserver` existant (`TerminalWebGPU.tsx:700`) redimensionne le PTY automatiquement, aucun travail supplémentaire.
- Structure du panneau, de haut en bas :
  1. En-tête : titre « Bloc-note » + nom du projet actif + bouton fermer.
  2. Zone d'écriture : `textarea` multi-lignes (hauteur confortable, ~8 lignes, scrollable).
  3. Bouton « Copier » (raccourci `Ctrl+Entrée` dans la textarea).
  4. Historique : liste scrollable des messages archivés, du plus récent au plus ancien. Chaque entrée : aperçu tronqué (2-3 lignes max) + au survol, actions « recharger dans l'éditeur » et « supprimer ». Clic sur l'entrée = re-copie au presse-papier (feedback visuel bref).

### Ouverture / fermeture

- **Icône bloc-note dans la toolbar** (`Toolbar.tsx`), placée juste à **gauche du bouton paramètres** en haut à droite. Même style que le bouton paramètres existant (icône lucide `NotebookPen`, taille 14, mêmes classes). Toggle ouvre/ferme le panneau ; état visuel « actif » quand le panneau est ouvert.
- Pas de raccourci clavier global d'ouverture.
- `Échap` : ferme le panneau quand le focus est à l'intérieur.
- `Ctrl+Entrée` dans la textarea : équivalent au bouton « Copier ».
- **Édition classique** : la zone d'écriture est une `textarea` native — Ctrl+A (tout sélectionner), Ctrl+C/X/V, Ctrl+flèches (saut de mot), Maj+flèches (sélection), Ctrl+Backspace, undo/redo natifs fonctionnent comme dans un bloc-note classique. Aucun handler clavier global de l'app ne doit intercepter ces touches quand le focus est dans le panneau (les handlers du terminal sont scopés à leur élément — vérifier seulement qu'aucun listener `window` n'interfère).

### Comportement « Copier »

1. Copie le contenu de la textarea au presse-papier (helper clipboard existant).
2. Archive le message en tête de l'historique du projet actif.
3. Vide la textarea (et le draft persisté).
4. Texte vide ou uniquement espaces → no-op.

### Historique et persistance

- **Par projet** : l'historique affiché est celui du projet actif (`activeProjectId`). Sans projet actif, le panneau affiche un message d'aide et désactive l'édition.
- Persistance via `@tauri-apps/plugin-store`, nouveau fichier `notepad.json` (séparé de `store.json` pour ne pas alourdir `saveState`) :

  ```ts
  // notepad.json — clé = projectId
  interface NotepadProjectState {
    draft: string; // texte en cours non copié
    history: NotepadEntry[]; // plus récent en premier
  }
  interface NotepadEntry {
    id: string;
    text: string;
    createdAt: number; // epoch ms
  }
  ```

- Cap : 100 entrées par projet (les plus anciennes sont supprimées).
- Le **draft** est persisté aussi (debounce ~500 ms sur la frappe) : on retrouve son texte en cours après fermeture/réouverture.
- Normalisation défensive au chargement (mêmes principes que `store.ts`).
- L'ouverture/fermeture du panneau n'est pas persistée (fermé au démarrage).

## 2. Bascule auto vers l'onglet « Active » de la sidebar

### Objectif

Quand un projet passe d'inactif à actif (l'utilisateur tape dans un de ses terminaux), la sidebar bascule automatiquement sur l'onglet « Active ».

### Design

- Dans `Sidepanel.tsx` : un `useEffect` garde le `activeProjectIds` précédent dans une ref. Si le nouveau set contient un id absent de l'ancien (transition inactif→actif), `setView("active")`.
- À **chaque** transition, même si l'utilisateur consultait l'onglet « Inactive ».
- Aucune bascule dans l'autre sens (actif→inactif ne touche pas la vue).
- Le premier rendu (ref vide → set initial) ne déclenche pas de bascule.

## 3. Sélection ancrée au scrollback + extension pendant le scroll

### Problème

La sélection est stockée en coordonnées *écran* dans le renderer WASM (`crates/terminal-renderer/src/lib.rs:303`). Conséquences : le surlignage reste figé sur les mêmes lignes d'écran quand on scrolle, et il est impossible de sélectionner plus d'un écran. `selection_text()` ne lit que le payload visible.

### Approche retenue

Coordonnées **absolues** (scrollback) dans le renderer + extraction du texte côté backend. (Alternatives rejetées : décaler la sélection à chaque scroll côté frontend — fragile, partie hors écran non représentable ; état sélection entièrement au backend — IPC à chaque mousemove.)

### Renderer WASM (`crates/terminal-renderer`)

- `Selection` passe en coordonnées absolues : `total_row` où 0 = plus vieille ligne du scrollback et `total_row = scroll_max - scroll_offset + viewport_row` (même convention que la recherche, cf. `terminal_state.rs:913`).
- `set_selection(start_col, start_total_row, end_col, end_total_row)` : signature identique, sémantique absolue.
- Au draw : conversion `viewport_row = total_row - (scroll_max - scroll_offset)` avec clipping hors `[0, rows)`. `RenderPayload` contient déjà `scroll_offset`/`scroll_max` (`payload.rs:60-62`) — le surlignage suit le texte à chaque frame.
- `selection_text()` du renderer est **supprimé** (remplacé par la commande backend) ; `has_selection()` / `clear_selection()` inchangés.

### Backend (`src-tauri`)

- Nouvelle commande `get_text_range(session_id, start_col, start_total_row, end_col, end_total_row) -> String` : lit scrollback + écran visible dans `terminal_state.rs` (l'accès par ligne existe déjà pour la recherche), applique la même logique de sélection (normalisation start/end, trim de fin de ligne, `\n` entre lignes, gestion des cellules larges).

### Frontend (`TerminalWebGPU.tsx`)

- `mousedown` / `mousemove` : conversion viewport→absolu via `pane.screen` (`visibleStart + row`) avant `set_selection`.
- **Extension à la molette pendant le drag** : on mémorise la dernière position souris du drag ; quand `scroll_offset` change pendant qu'un drag est en cours, on recalcule l'extrémité de la sélection à partir de cette position → la sélection s'étend au-delà d'un écran.
- **Auto-scroll au bord** : pendant un drag, si le curseur sort au-dessus/en-dessous du terminal, un timer (~50 ms) scrolle dans la direction correspondante (vitesse proportionnelle au dépassement, comme WezTerm) et étend la sélection.
- **Copie** : `Ctrl+C` et le menu contextuel appellent `get_text_range` (async) au lieu de `selection_text()` du renderer. La sélection courante (coords absolues) est gardée dans une ref côté frontend pour construire l'appel.

### Cas limites

- **Alt screen** (claude code, vim, less) : `scroll_max = 0`, coordonnées absolues = coordonnées écran — comportement identique à aujourd'hui. La sélection locale n'est de toute façon active que hors mouse-mode (ou avec Shift).
- **Scrollback au cap (10k)** pendant une sélection : les indices peuvent dériver d'une ligne quand des lignes anciennes sont éjectées — accepté, négligeable en pratique.
- **Resize** : les colonnes changent sans reflow du scrollback ; la sélection est effacée au resize (comportement simple et prévisible).

## Tests

- **Bloc-note** : tests du module de persistance (`notepad-store`) — normalisation, cap 100, draft. Test composant léger si l'infra de test front existe (sinon vérification manuelle).
- **Sidebar** : test du hook/effet de transition (apparition d'un id → vue « active » ; rendu initial → pas de bascule).
- **Sélection** : tests Rust unitaires sur `get_text_range` (multi-lignes scrollback+écran, trim, cellules larges, bornes inversées) et sur la conversion absolue→viewport du renderer. Vérification manuelle du drag + molette + auto-scroll.

## Ordre d'implémentation suggéré

1. §2 bascule sidebar (minuscule, livrable seul).
2. §1 bloc-note (frontend pur + store).
3. §3 sélection (Rust renderer + backend + frontend, le plus gros morceau).
