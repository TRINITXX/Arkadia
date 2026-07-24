import { useState } from "react";
import { customAsPalette, PALETTES } from "@/lib/palettes";
import { BACKGROUNDS } from "@/lib/backgrounds";
import {
  NOTIF_WIDTH_MAX,
  NOTIF_WIDTH_MIN,
  SCROLLBACK_LINES_DEFAULT,
  SCROLLBACK_LINES_MAX,
  SCROLLBACK_LINES_MIN,
  type BackgroundId,
  type CustomPalette,
  type EditorProtocol,
  type NotifStyle,
  type PaletteId,
  type TerminalFont,
  type ToolbarButton,
  type ToolDensity,
} from "@/types";
import { ToolbarSettings } from "@/components/ToolbarSettings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  buttons: ToolbarButton[];
  onChangeButtons: (next: ToolbarButton[]) => void;
  promptButtons: ToolbarButton[];
  onChangePromptButtons: (next: ToolbarButton[]) => void;
  promptBarEnabled: boolean;
  onChangePromptBarEnabled: (next: boolean) => void;
  font: TerminalFont;
  onChangeFont: (next: TerminalFont) => void;
  paletteId: PaletteId;
  onChangePaletteId: (next: PaletteId) => void;
  backgroundId: BackgroundId;
  onChangeBackgroundId: (next: BackgroundId) => void;
  useWebGPU: boolean;
  onChangeUseWebGPU: (next: boolean) => void;
  scrollbackLines: number;
  onChangeScrollbackLines: (next: number) => void;
  customPalette: CustomPalette;
  onChangeCustomPalette: (next: CustomPalette) => void;
  editorProtocol: EditorProtocol;
  onChangeEditorProtocol: (next: EditorProtocol) => void;
  notifStyle: NotifStyle;
  onChangeNotifStyle: (next: NotifStyle) => void;
  notifFullscreen: boolean;
  onChangeNotifFullscreen: (next: boolean) => void;
  notifWidth: number;
  onChangeNotifWidth: (next: number) => void;
  navRailEnabled: boolean;
  onChangeNavRailEnabled: (next: boolean) => void;
  messageFramesEnabled: boolean;
  onChangeMessageFramesEnabled: (next: boolean) => void;
  autoScrollReplyEnabled: boolean;
  onChangeAutoScrollReplyEnabled: (next: boolean) => void;
  toolDensity: ToolDensity;
  onChangeToolDensity: (next: ToolDensity) => void;
}

type Tab = "toolbar" | "prompt" | "general";

export function SettingsDialog({
  open,
  onClose,
  buttons,
  onChangeButtons,
  promptButtons,
  onChangePromptButtons,
  promptBarEnabled,
  onChangePromptBarEnabled,
  font,
  onChangeFont,
  paletteId,
  onChangePaletteId,
  backgroundId,
  onChangeBackgroundId,
  useWebGPU,
  onChangeUseWebGPU,
  scrollbackLines,
  onChangeScrollbackLines,
  customPalette,
  onChangeCustomPalette,
  editorProtocol,
  onChangeEditorProtocol,
  notifStyle,
  onChangeNotifStyle,
  notifFullscreen,
  onChangeNotifFullscreen,
  notifWidth,
  onChangeNotifWidth,
  navRailEnabled,
  onChangeNavRailEnabled,
  messageFramesEnabled,
  onChangeMessageFramesEnabled,
  autoScrollReplyEnabled,
  onChangeAutoScrollReplyEnabled,
  toolDensity,
  onChangeToolDensity,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("toolbar");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="chrome-surface flex h-[640px] w-[760px] flex-col rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-base font-semibold tracking-tight">Settings</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
            type="button"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <nav className="w-44 shrink-0 border-r border-zinc-800 p-2">
            <SettingsNavItem
              active={tab === "toolbar"}
              onClick={() => setTab("toolbar")}
            >
              Toolbar
            </SettingsNavItem>
            <SettingsNavItem
              active={tab === "prompt"}
              onClick={() => setTab("prompt")}
            >
              Prompt buttons
            </SettingsNavItem>
            <SettingsNavItem
              active={tab === "general"}
              onClick={() => setTab("general")}
            >
              General
            </SettingsNavItem>
          </nav>

          <div
            className={`flex-1 p-5 ${
              tab === "toolbar" || tab === "prompt"
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto"
            }`}
          >
            {tab === "toolbar" && (
              <ToolbarSettings
                buttons={buttons}
                onChangeButtons={onChangeButtons}
              />
            )}
            {tab === "prompt" && (
              <ToolbarSettings
                buttons={promptButtons}
                onChangeButtons={onChangePromptButtons}
                heading="Prompt buttons"
                subheading="Boutons de la barre du bas : insèrent (ou envoient) leur texte dans le pane Claude actif."
                commandLabel="Texte"
                commandPlaceholder="texte envoyé à Claude (multi-lignes OK)"
                showSubmit
              />
            )}
            {tab === "general" && (
              <GeneralSettings
                font={font}
                onChangeFont={onChangeFont}
                paletteId={paletteId}
                onChangePaletteId={onChangePaletteId}
                backgroundId={backgroundId}
                onChangeBackgroundId={onChangeBackgroundId}
                useWebGPU={useWebGPU}
                onChangeUseWebGPU={onChangeUseWebGPU}
                scrollbackLines={scrollbackLines}
                onChangeScrollbackLines={onChangeScrollbackLines}
                customPalette={customPalette}
                onChangeCustomPalette={onChangeCustomPalette}
                editorProtocol={editorProtocol}
                onChangeEditorProtocol={onChangeEditorProtocol}
                notifStyle={notifStyle}
                onChangeNotifStyle={onChangeNotifStyle}
                notifFullscreen={notifFullscreen}
                onChangeNotifFullscreen={onChangeNotifFullscreen}
                notifWidth={notifWidth}
                onChangeNotifWidth={onChangeNotifWidth}
                navRailEnabled={navRailEnabled}
                onChangeNavRailEnabled={onChangeNavRailEnabled}
                promptBarEnabled={promptBarEnabled}
                onChangePromptBarEnabled={onChangePromptBarEnabled}
                messageFramesEnabled={messageFramesEnabled}
                onChangeMessageFramesEnabled={onChangeMessageFramesEnabled}
                autoScrollReplyEnabled={autoScrollReplyEnabled}
                onChangeAutoScrollReplyEnabled={onChangeAutoScrollReplyEnabled}
                toolDensity={toolDensity}
                onChangeToolDensity={onChangeToolDensity}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsNavItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`mb-0.5 block w-full rounded px-2 py-1.5 text-left text-sm ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
      type="button"
    >
      {children}
    </button>
  );
}

interface GeneralSettingsProps {
  font: TerminalFont;
  onChangeFont: (next: TerminalFont) => void;
  paletteId: PaletteId;
  onChangePaletteId: (next: PaletteId) => void;
  backgroundId: BackgroundId;
  onChangeBackgroundId: (next: BackgroundId) => void;
  useWebGPU: boolean;
  onChangeUseWebGPU: (next: boolean) => void;
  scrollbackLines: number;
  onChangeScrollbackLines: (next: number) => void;
  customPalette: CustomPalette;
  onChangeCustomPalette: (next: CustomPalette) => void;
  editorProtocol: EditorProtocol;
  onChangeEditorProtocol: (next: EditorProtocol) => void;
  notifStyle: NotifStyle;
  onChangeNotifStyle: (next: NotifStyle) => void;
  notifFullscreen: boolean;
  onChangeNotifFullscreen: (next: boolean) => void;
  notifWidth: number;
  onChangeNotifWidth: (next: number) => void;
  navRailEnabled: boolean;
  onChangeNavRailEnabled: (next: boolean) => void;
  promptBarEnabled: boolean;
  onChangePromptBarEnabled: (next: boolean) => void;
  messageFramesEnabled: boolean;
  onChangeMessageFramesEnabled: (next: boolean) => void;
  autoScrollReplyEnabled: boolean;
  onChangeAutoScrollReplyEnabled: (next: boolean) => void;
  toolDensity: ToolDensity;
  onChangeToolDensity: (next: ToolDensity) => void;
}

const TOOL_DENSITIES: { id: ToolDensity; label: string; hint: string }[] = [
  { id: "compact", label: "Compact", hint: "1 ligne / outil, replié" },
  { id: "preview", label: "Aperçu", hint: "en-tête + 2-3 lignes" },
  { id: "full", label: "Déplié", hint: "sortie complète" },
];

const NOTIF_STYLES: { id: NotifStyle; label: string; hint: string }[] = [
  { id: "off", label: "Désactivée", hint: "Aucune notification" },
  { id: "mirror", label: "Aperçu complet", hint: "Miroir du terminal" },
  { id: "compact", label: "Compacte", hint: "Projet · onglet" },
];

const EDITOR_PROTOCOLS: { id: EditorProtocol; label: string; hint: string }[] =
  [
    { id: "vscode", label: "VS Code", hint: "vscode://file/…" },
    { id: "cursor", label: "Cursor", hint: "cursor://file/…" },
    { id: "idea", label: "IntelliJ IDEA", hint: "idea://open?file=…" },
    { id: "fleet", label: "Fleet", hint: "fleet://file/…" },
  ];

const ANSI_LABELS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright black",
  "bright red",
  "bright green",
  "bright yellow",
  "bright blue",
  "bright magenta",
  "bright cyan",
  "bright white",
] as const;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function HexInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const valid = HEX_COLOR_RE.test(value);
  return (
    <label className="flex items-center gap-2 text-[11px] text-zinc-400">
      <span
        className="h-5 w-5 shrink-0 rounded border border-zinc-700"
        style={{ backgroundColor: valid ? value : "transparent" }}
      />
      <span className="w-28 shrink-0 truncate">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={`w-20 rounded border bg-zinc-950 px-2 py-1 font-mono text-xs outline-none ${
          valid
            ? "border-zinc-800 focus:border-zinc-600"
            : "border-red-700 focus:border-red-500"
        }`}
      />
    </label>
  );
}

function CustomPaletteEditor({
  customPalette,
  onChangeCustomPalette,
}: {
  customPalette: CustomPalette;
  onChangeCustomPalette: (next: CustomPalette) => void;
}) {
  const setAnsi = (idx: number, value: string) => {
    const ansi = [...customPalette.ansi];
    ansi[idx] = value;
    onChangeCustomPalette({ ...customPalette, ansi });
  };
  return (
    <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/40 p-3">
      <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        Custom palette editor
      </h5>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <HexInput
          label="background"
          value={customPalette.bg}
          onChange={(v) => onChangeCustomPalette({ ...customPalette, bg: v })}
        />
        <HexInput
          label="foreground"
          value={customPalette.fg}
          onChange={(v) => onChangeCustomPalette({ ...customPalette, fg: v })}
        />
        {customPalette.ansi.map((c, i) => (
          <HexInput
            key={i}
            label={`${i} · ${ANSI_LABELS[i]}`}
            value={c}
            onChange={(v) => setAnsi(i, v)}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">
        Format `#RRGGBB`. Les valeurs invalides sont ignorées au save (encadré
        rouge en attendant).
      </p>
    </div>
  );
}

const FONT_FAMILY_OPTIONS = [
  {
    label: "Maple Mono NF (WezTerm)",
    value: "Maple Mono NF, Maple Mono, Consolas, monospace",
  },
  { label: "JetBrains Mono", value: "JetBrains Mono, Consolas, monospace" },
  {
    label: "Cascadia Code",
    value: "Cascadia Code, Consolas, Courier New, monospace",
  },
  {
    label: "Cascadia Mono",
    value: "Cascadia Mono, Consolas, Courier New, monospace",
  },
  { label: "Consolas", value: "Consolas, Courier New, monospace" },
  { label: "Courier New", value: "Courier New, monospace" },
  { label: "Lucida Console", value: "Lucida Console, Consolas, monospace" },
  { label: "Fira Code", value: "Fira Code, Consolas, monospace" },
  { label: "Source Code Pro", value: "Source Code Pro, Consolas, monospace" },
  { label: "Hack", value: "Hack, Consolas, monospace" },
];

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 28;

function clampSize(n: number): number {
  if (Number.isNaN(n)) return FONT_SIZE_MIN;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)));
}

function SettingToggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-3 ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-zinc-300"
      />
      <span>
        <span className="block text-sm text-zinc-200">{label}</span>
        <span className="mt-0.5 block text-[11px] text-zinc-500">{hint}</span>
      </span>
    </label>
  );
}

function GeneralSettings({
  font,
  onChangeFont,
  paletteId,
  onChangePaletteId,
  backgroundId,
  onChangeBackgroundId,
  useWebGPU,
  onChangeUseWebGPU,
  scrollbackLines,
  onChangeScrollbackLines,
  customPalette,
  onChangeCustomPalette,
  editorProtocol,
  onChangeEditorProtocol,
  notifStyle,
  onChangeNotifStyle,
  notifFullscreen,
  onChangeNotifFullscreen,
  notifWidth,
  onChangeNotifWidth,
  navRailEnabled,
  onChangeNavRailEnabled,
  promptBarEnabled,
  onChangePromptBarEnabled,
  messageFramesEnabled,
  onChangeMessageFramesEnabled,
  autoScrollReplyEnabled,
  onChangeAutoScrollReplyEnabled,
  toolDensity,
  onChangeToolDensity,
}: GeneralSettingsProps) {
  const allPalettes = [...PALETTES, customAsPalette(customPalette)];
  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold tracking-tight">General</h3>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Terminal font
        </h4>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">
              Font family
            </span>
            <select
              value={font.family}
              onChange={(e) =>
                onChangeFont({ ...font, family: e.target.value })
              }
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-sm outline-none focus:border-zinc-600"
            >
              {!FONT_FAMILY_OPTIONS.some((o) => o.value === font.family) && (
                <option value={font.family}>Custom: {font.family}</option>
              )}
              {FONT_FAMILY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-zinc-600">
              La première police installée sur le système est utilisée, avec
              fallback automatique sur Consolas / monospace.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-xs text-zinc-400">
              <span>Font size</span>
              <span className="font-mono text-zinc-300">{font.size}px</span>
            </span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                value={font.size}
                onChange={(e) =>
                  onChangeFont({
                    ...font,
                    size: clampSize(parseInt(e.target.value, 10)),
                  })
                }
                className="flex-1 accent-zinc-300"
              />
              <input
                type="number"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                value={font.size}
                onChange={(e) =>
                  onChangeFont({
                    ...font,
                    size: clampSize(parseInt(e.target.value, 10)),
                  })
                }
                className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-zinc-600"
              />
            </div>
          </label>

          <div
            style={{
              fontFamily: font.family,
              fontSize: `${font.size}px`,
              lineHeight: 1.25,
            }}
            className="rounded border border-zinc-800 bg-black px-3 py-2 text-zinc-200"
          >
            <div>The quick brown fox jumps over the lazy dog 0123456789</div>
            <div className="text-zinc-500">
              PS C:\Users\you&gt;{" "}
              <span className="text-zinc-200">npm run dev</span>
            </div>
            <div className="text-emerald-400">{"→ ✓ ready in 234ms"}</div>
          </div>
        </div>
      </section>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Renderer
        </h4>
        <label className="flex items-start gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-3">
          <input
            type="checkbox"
            checked={useWebGPU}
            onChange={(e) => onChangeUseWebGPU(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-zinc-300"
          />
          <span>
            <span className="block text-sm text-zinc-200">
              Renderer GPU (expérimental)
            </span>
            <span className="mt-0.5 block text-[11px] text-zinc-500">
              Utilise WebGPU + un atlas Cascadia Code embedded au lieu du rendu
              HTML. Recharge ou réactive le pane pour appliquer.
            </span>
          </span>
        </label>
      </section>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Scrollback
        </h4>
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm text-zinc-200">
                {"Lignes d'historique par pane"}
              </span>
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                {
                  "Nombre max de lignes gardées en mémoire par terminal (1 000 – 100 000). S'applique immédiatement, y compris aux panes ouverts."
                }
              </span>
            </span>
            <input
              type="number"
              min={SCROLLBACK_LINES_MIN}
              max={SCROLLBACK_LINES_MAX}
              step={1000}
              value={scrollbackLines}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) onChangeScrollbackLines(v);
              }}
              onBlur={(e) => {
                // Re-clamp on blur so a hand-typed out-of-range value snaps back.
                const v = parseInt(e.target.value, 10);
                onChangeScrollbackLines(
                  Number.isNaN(v)
                    ? SCROLLBACK_LINES_DEFAULT
                    : Math.min(
                        SCROLLBACK_LINES_MAX,
                        Math.max(SCROLLBACK_LINES_MIN, v),
                      ),
                );
              }}
              className="w-24 shrink-0 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-zinc-600"
            />
          </label>
        </div>
      </section>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Affichage
        </h4>
        <div className="space-y-2">
          <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="mb-0.5 text-sm text-zinc-200">
              Notification quand Claude attend
            </div>
            <div className="mb-2.5 text-[11px] text-zinc-500">
              {
                "Quand Claude attend une réponse (ou a terminé) et qu'Arkadia est en arrière-plan, en bas à droite de l'écran."
              }
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NOTIF_STYLES.map((opt) => {
                const selected = opt.id === notifStyle;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChangeNotifStyle(opt.id)}
                    className={`rounded border p-2.5 text-left transition ${
                      selected
                        ? "border-zinc-300 bg-zinc-900 ring-1 ring-zinc-300"
                        : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                    }`}
                  >
                    <div className="text-[13px] text-zinc-100">{opt.label}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {opt.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <SettingToggle
            checked={notifFullscreen}
            onChange={onChangeNotifFullscreen}
            disabled={notifStyle === "off"}
            label="Afficher même en plein écran (jeu/vidéo)"
            hint="Par défaut, la notif est masquée quand un jeu ou une vidéo occupe tout l'écran. Les jeux en plein écran exclusif restent toujours protégés : la notif n'y est jamais affichée (elle ferait sortir le jeu du plein écran)."
          />
          {notifStyle === "compact" && (
            <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
              <label className="block">
                <span className="mb-1 flex items-baseline justify-between text-sm text-zinc-200">
                  <span>Largeur de la notification compacte</span>
                  <span className="font-mono text-xs text-zinc-400">
                    {notifWidth}px
                  </span>
                </span>
                <input
                  type="range"
                  min={NOTIF_WIDTH_MIN}
                  max={NOTIF_WIDTH_MAX}
                  step={10}
                  value={notifWidth}
                  onChange={(e) =>
                    onChangeNotifWidth(parseInt(e.target.value, 10))
                  }
                  className="w-full accent-zinc-300"
                />
                <span className="mt-1 block text-[11px] text-zinc-500">
                  {
                    "La police du nom d'onglet s'ajuste pour rentrer dans cette largeur."
                  }
                </span>
              </label>
            </div>
          )}
          <SettingToggle
            checked={navRailEnabled}
            onChange={onChangeNavRailEnabled}
            label="Boutons de navigation"
            hint="La barre de boutons à droite du terminal pour sauter entre les messages."
          />
          <SettingToggle
            checked={promptBarEnabled}
            onChange={onChangePromptBarEnabled}
            label="Barre de prompts (bas)"
            hint="La barre du bas, affichée sur les panes Claude, dont les boutons insèrent ou envoient du texte dans le champ. Configure les boutons dans l'onglet « Prompt buttons »."
          />
          <SettingToggle
            checked={messageFramesEnabled}
            onChange={onChangeMessageFramesEnabled}
            label="Cadres autour des messages"
            hint="Les cadres vert (tes messages) et violet (Claude) autour des réponses."
          />
          <SettingToggle
            checked={autoScrollReplyEnabled}
            onChange={onChangeAutoScrollReplyEnabled}
            label="Défilement auto vers la réponse"
            hint="Quand Claude a fini, remonte au début de sa dernière réponse pour la lire du haut."
          />
        </div>
      </section>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Vue moderne
        </h4>
        <p className="mb-3 text-[11px] text-zinc-500">
          {
            "Densité par défaut des cartes d'appel d'outil dans la vue moderne (toggle dans la barre d'outils)."
          }
        </p>
        <div className="grid grid-cols-3 gap-2">
          {TOOL_DENSITIES.map((opt) => {
            const selected = opt.id === toolDensity;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeToolDensity(opt.id)}
                className={`rounded border p-3 text-left transition ${
                  selected
                    ? "border-zinc-300 bg-zinc-900 ring-1 ring-zinc-300"
                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
                }`}
              >
                <div className="text-sm text-zinc-100">{opt.label}</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  {opt.hint}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          {"Fond de l'application"}
        </h4>
        <p className="mb-3 text-[11px] text-zinc-500">
          {
            "Dégradé appliqué au chrome (barres, panneaux, dialogues, vue moderne) avec un effet verre dépoli. « Noir » garde l'apparence opaque actuelle. Les terminaux restent opaques pour la lisibilité."
          }
        </p>
        <div className="grid grid-cols-4 gap-2">
          {BACKGROUNDS.map((bg) => {
            const selected = bg.id === backgroundId;
            return (
              <button
                key={bg.id}
                type="button"
                onClick={() => onChangeBackgroundId(bg.id)}
                title={bg.name}
                className={`flex h-16 flex-col justify-end rounded border p-2 text-left transition ${
                  selected
                    ? "border-zinc-300 ring-1 ring-zinc-300"
                    : "border-zinc-800 hover:border-zinc-600"
                }`}
                style={{ background: bg.css }}
              >
                <span className="rounded bg-black/40 px-1 text-[10px] text-zinc-100">
                  {bg.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Color palette
        </h4>
        <div className="grid grid-cols-2 gap-3">
          {allPalettes.map((p) => {
            const selected = p.id === paletteId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChangePaletteId(p.id)}
                style={{ backgroundColor: p.bg, color: p.fg }}
                className={`rounded border p-3 text-left transition ${
                  selected
                    ? "border-zinc-300 ring-1 ring-zinc-300"
                    : "border-zinc-800 hover:border-zinc-600"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    style={{
                      fontFamily: font.family,
                      fontSize: 13,
                    }}
                  >
                    {p.name}
                  </span>
                  {selected && (
                    <span
                      className="text-[10px] uppercase tracking-wide"
                      style={{ color: p.fg, opacity: 0.7 }}
                    >
                      selected
                    </span>
                  )}
                </div>
                <div className="mb-1.5 flex h-3 overflow-hidden rounded">
                  {p.ansi.slice(0, 8).map((c, i) => (
                    <div
                      key={i}
                      style={{ backgroundColor: c }}
                      className="flex-1"
                    />
                  ))}
                </div>
                <div className="flex h-3 overflow-hidden rounded">
                  {p.ansi.slice(8, 16).map((c, i) => (
                    <div
                      key={i + 8}
                      style={{ backgroundColor: c }}
                      className="flex-1"
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        {paletteId === "custom" && (
          <CustomPaletteEditor
            customPalette={customPalette}
            onChangeCustomPalette={onChangeCustomPalette}
          />
        )}
      </section>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Editor protocol
        </h4>
        <p className="mb-3 text-[11px] text-zinc-500">
          Schéma utilisé quand on clique sur un `path:line:col` dans le
          terminal.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {EDITOR_PROTOCOLS.map((opt) => {
            const selected = opt.id === editorProtocol;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeEditorProtocol(opt.id)}
                className={`rounded border p-3 text-left transition ${
                  selected
                    ? "border-zinc-300 bg-zinc-900 ring-1 ring-zinc-300"
                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
                }`}
              >
                <div className="text-sm text-zinc-100">{opt.label}</div>
                <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  {opt.hint}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
