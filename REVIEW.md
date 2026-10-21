# REVIEW.md

Lu par toute review de ce repo. Une remarque de review qui revient s'ajoute ici.

## Ce qu'est un bug ici

- **Transcript perdu** : un terminal qui lance Claude Code avec un mauvais environnement. Chaque pane reçoit le `CLAUDE_CONFIG_DIR` de son compte (`accounts.rs`, `terminal.rs`) ; une variable héritée d'une session Claude parente (`CLAUDECODE`, `CLAUDE_CODE_*`) fait qu'aucune conversation n'est sauvegardée (vu le 11/10/2026).
- **Fuite mémoire** : un `listen()` Tauri sans désabonnement au démontage (déjà vu : plusieurs Go). Idem pour un `ResizeObserver` ou un écouteur `window`.
- **Fenêtre bloquée ou perdue** : une fenêtre sans moyen de se fermer, une popup placée hors écran, un gestionnaire `onCloseRequested` qui bloque la fermeture. Le chien de garde (`uiwatch.rs`) peut reconstruire la fenêtre `main` : rien ne doit supposer qu'elle vit toute la session.
- **Commande Tauri qui gèle l'interface** : une commande synchrone qui crée une fenêtre ou une vue web attend le thread principal et le bloque. Ces commandes sont `async`.
- **Contenu distant** : une page web extérieure (panneau d'artefacts, `artifact_view.rs`) qui obtient l'accès aux commandes. Les capacités ne protègent que les plugins : sans manifeste ACL applicatif, Tauri laisse passer toute commande de l'app, quelle que soit l'origine. Toute fenêtre de contenu distant porte un libellé que `artifact_view::guard` refuse, et aucune capacité ne la liste.
- **Panneau d'artefacts** : tout chemin qui retire un onglet (`closeTab`, `closeProjectTabs`, `onDeleteProject`, et tout futur) appelle `dropTab`, sinon ses fenêtres d'artefacts restent cachées et vivantes. Une commande qui attend le thread principal (placer, construire) revérifie l'état (`active`, `hidden`) avant d'afficher une fenêtre.
- **Résultat asynchrone après démontage** : un `invoke` attendu dans un composant ou un hook revérifie qu'il est encore monté (et sur le même artefact) avant d'appliquer son résultat ; sinon il libère ce qu'il a obtenu (capture de zone, 21/10/2026).
- **Rangée qui déborde** : un élément cliquable qui dépasse doit rester joignable (défilement à la molette, élément actif ramené en vue). Seule exception voulue : les boutons de la barre du haut, cachés quand ils ne tiennent pas.
- **Deux Arkadia à la fois** (quotidien + `tauri dev`) : un dossier de `%LOCALAPPDATA%\Arkadia` partagé par les deux ne doit pas laisser l'un consommer ce qui revient à l'autre (voir `artifact_inbox` : chacun ne prend que ses panes).
- **`BROWSER` des panes** : gh, Python et d'autres le découpent comme une commande shell. Chemin sans espace et en barres obliques `/` ; tout argument unique qui ne commence pas par `--` s'ouvre comme sans `BROWSER`, jamais en lançant un second Arkadia.
- **Fonctions `unstable` de Tauri** : elles rendent toute fenêtre multi-vues, ce qui casse `get_webview_window("main")` et le focus clavier (relecture du 18/10/2026). Ne pas les activer.
- **Liens et chemins cliquables** : un chemin coupé par un retour à la ligne, des espaces insécables, des crochets ou des guillemets qui n'ouvre plus rien (5 correctifs passés).
- **Rendu WebGPU** : un device par pane ou plusieurs présentations par frame (perte du device).
- **Fond « glass »** : un menu ou une vue de lecture qui devient transparent.

## Zones sensibles

Un changement qui touche une de ces zones se propose en `/review-maison` :

- Comptes et lancement des terminaux : `src-tauri/src/accounts.rs`, `src-tauri/src/terminal.rs`
- Fenêtres et chien de garde : `src-tauri/src/uiwatch.rs`, `src-tauri/src/popup.rs`
- Compagnon téléphone (accès distant par Tailscale) : `src-tauri/src/remote/`, `src-tauri/src/gate.rs`, `src/mobile/`
- Contenu distant : `src-tauri/src/artifact_view.rs`, `src-tauri/capabilities/`

## Décisions à ne pas signaler

- Libellés d'interface mêlant français et anglais : existant, hors sujet d'une review.
- Composants en PascalCase (`NotepadPanel.tsx`) : convention du repo.
- Le panneau d'artefacts est une fenêtre séparée posée sur le panneau React, et non une vue enfant : voulu, voir « Fonctions `unstable` ».

## Chemins à ignorer

`target/`, `target-verify/`, `dist/`, `node_modules/`, `crates/terminal-renderer/pkg/`
