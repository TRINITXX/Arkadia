# Vue chat d'Arkadia (sans terminal) — Design

**Date** : 2026-10-30
**Statut** : cadré avec Alexis (grilling en 3 rondes + maquettes), à construire dans Arkadia Lab
**Pages de cadrage** : https://claude.ai/artifact/9QgsgC2a6P5S8gWAW7LbKs (série 1),
https://claude.ai/artifact/4ygAKWmakGHnqkyz2MQ8QQ (série 2), maquettes https://claude.ai/artifact/YHXWKTw6q6UA7jfDepvS8p

## But

Remplacer la vue lecture (transcript JSONL au-dessus du vrai terminal, voir
`2026-06-16-modern-view-design.md`) par une vraie vue chat façon application d'IA de bureau
(Claude desktop, Codex, T3 Code), **sans perdre aucune info en direct** de la zone du bas du
terminal : questions, plan, permissions, tâches, sous-agents, statut, barre d'état.

Ce qui a fait lâcher la vue lecture actuelle : pas assez « vraie appli », et la zone du bas
recopiée du terminal coupée au mauvais endroit.

## Décisions verrouillées

1. **Sans terminal** (option D) : Claude est piloté par le kit officiel `@anthropic-ai/claude-agent-sdk`,
   comme T3 Code. Usage perso sur l'abonnement autorisé (article d'aide Anthropic
   https://support.claude.com/en/articles/15036540, état du 27/10/2026), mêmes quotas que le
   terminal. Arkadia ne lit ni ne copie jamais le jeton : le binaire officiel se connecte seul.
2. **Arkadia Lab** : tout se construit dans le worktree `Arkadia-lab` (branche `master-lab`),
   build séparé qui tourne à côté du quotidien (`lab.rs`, `Rebuild Arkadia Lab.bat`). Le Lab part
   de la liste de projets du quotidien sans ses onglets, et laisse notifications, téléphone, gate,
   boîte d'artefacts et hellos de quota au quotidien.
3. **Bascule chat / terminal sur le même onglet** : un bouton en haut à droite. La même
   conversation passe de l'un à l'autre (`--resume <id>` d'un côté, `resume` du SDK de l'autre).
   Jamais deux processus Claude sur la même session : on ferme l'un avant d'ouvrir l'autre.
   Dans le Lab, un nouvel onglet Claude s'ouvre **en chat**.
4. **Vocal de Claude par un Claude Code caché** : un terminal invisible fait tourner `claude`
   (programme officiel, connexion claude.ai) ; le push-to-talk lui envoie l'espace maintenu, le
   texte dicté est lu dans son champ de saisie puis vidé et versé dans la saisie du chat.
   Reprend le mécanisme du bouton de dictée du rail (`PaneInputRail`, `dictationEnd.ts`,
   `isDictating`). Aucun envoi (Entrée) dans ce terminal, jamais. À prototyper en premier.
5. **T3 Code (MIT, © 2026 T3 Tools Inc.)** : on emprunte les pièces détachables, Arkadia garde
   React 18. Candidats : `markdownStreamBlocks.ts`, `markdown-incremental.ts`, la logique de
   regroupement du journal d'outils (`WorkLog`), le panneau de questions
   (`ComposerPendingUserInputPanel`), la carte de plan (`ProposedPlanCard`), la jauge de contexte
   (`ContextWindowMeter`). Leur moteur (Effect-TS, Electron) ne se transplante pas. Garder la
   notice MIT dans chaque fichier repris.
6. **Maquette A « Colonne calme »** : colonne centrée (~740 px), titre de session à empattements
   avec un mot en italique, messages de l'utilisateur en bulle à droite, texte de Claude sans
   bulle, outils repliés en une ligne (« 4 commandes, 3 fichiers lus · 12 s »), modifications en
   cartes avec diff, ligne « Claude travaille · durée · jetons » au-dessus de la saisie avec puces
   sous-agents et tâches, **question qui s'ouvre dans la grande carte de saisie** (options au
   clavier, Échap pour écrire), barre d'état sous la saisie. Un seul accent (terre cuite).
7. **Sous-agents** : la puce « N sous-agents » ouvre un tiroir (chaque sous-agent, ses étapes,
   sa durée), d'où on peut **ouvrir sa conversation complète** dans un fil à part (façon T3 Code).
8. **Barre d'état** : la même que celle du terminal aujourd'hui (ccstatusline) : modèle, contexte
   utilisable, heure du reset, branche git, quota de session (5 h), quota de la semaine.
9. **Touches et modes** : ceux de Claude Code (Entrée envoie, Maj+Entrée saut de ligne, Échap
   interrompt, Maj+Tab change de mode ; modes auto, plan, accepter les modifs). Images collées.
10. **Téléphone : après le Lab.** La conversation vit côté PC (pas seulement dans la page), pour
    que le téléphone puisse l'afficher plus tard.

## Architecture

- **Serveur Node à côté d'Arkadia** (sidecar, comme le serveur de T3 Code) : un processus pour
  l'instance, une `query()` longue par onglet chat, alimentée par une file (mode « entrée en
  flux », requis pour `interrupt()`, `setModel()`, `setPermissionMode()`, les images).
  `includePartialMessages: true` pour le texte en direct.
- **Rust ↔ Node** : lignes JSON sur stdio. Rust relaie vers la page (événements Tauri par volet)
  et garde l'état de chaque conversation, pour le téléphone plus tard.
- **Permissions, AskUserQuestion, ExitPlanMode** : `canUseTool`, qui attend la réponse de la page.
  Réponse à une question : `updatedInput.answers`. Validation du plan par `ExitPlanMode` dans
  `canUseTool` : non documentée, à vérifier (T3 Code capture le plan puis refuse l'outil).
- **Compte de l'onglet** : `env` de la query avec `CLAUDE_CONFIG_DIR` pour un compte secondaire,
  sans la variable pour le principal (règle d'`accounts.rs`). `env` remplace tout
  l'environnement : repartir de celui du processus, retirer les marques de session Claude
  (`forget_parent_claude_session`), poser `ARKADIA_PANE_ID` (hooks) et, dans le Lab, `ARKADIA_LAB`.
- **Même version de Claude que le terminal** : `pathToClaudeCodeExecutable` vers le `claude`
  installé, sinon le SDK lance son propre binaire, d'une autre version.
- **Historique** : à l'ouverture ou à la reprise, les messages passés viennent du transcript JSONL
  (lecteur existant de `conversation.rs`), puis le direct vient du SDK.
- **Tâches** : sur Opus 5.5, Claude Code utilise TaskCreate/TaskUpdate (fichiers
  `<config>/tasks/<id>/*.json`, lus par T3 Code) ; TodoWrite seulement avec
  `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`.
- **Quotas** : `rate_limit_event` (statut, `resetsAt`, `utilization`), `getContextUsage()`.

## Étapes

1. Prototype du vocal (Claude Code caché) : le risque principal, testé avant le reste.
2. Serveur Node + SDK + texte en direct dans un onglet chat, saisie minimale.
3. Interactif : permissions, questions, plan, tâches, interruption, modes.
4. Rendu de la maquette A : outils groupés, cartes de diff, ligne « Claude travaille », puces,
   barre d'état, titre.
5. Historique depuis le JSONL et bascule chat ↔ terminal.
6. Tiroir des sous-agents et fil complet, menu des commandes `/`, images collées, choix du
   modèle et de l'effort.
7. Usage quotidien dans le Lab, puis décision téléphone, puis rapatriement (`/m`).

## Risques / notes

- La règle d'Anthropic sur le SDK avec un abonnement a bougé 2 fois en 2026 : la revérifier
  avant le rapatriement dans le quotidien.
- Chaque conversation en chat est un processus Claude Code (~250 Mo), comme un terminal.
- Les badges d'onglet (vert / orange) viennent aujourd'hui du titre du terminal : en chat, ils
  viennent de l'état du SDK.
- Le vocal dépend de l'affichage de Claude Code (déjà le cas pour le rail).
