import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { customAsPalette, PALETTES } from "@/lib/palettes";
import type {
  CustomPalette,
  EditorProtocol,
  PaletteId,
  TerminalFont,
  ToolbarButton,
} from "@/types";
import { ToolbarSettings } from "@/components/ToolbarSettings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  buttons: ToolbarButton[];
  onChangeButtons: (next: ToolbarButton[]) => void;
  font: TerminalFont;
  onChangeFont: (next: TerminalFont) => void;
  paletteId: PaletteId;
  onChangePaletteId: (next: PaletteId) => void;
  useWebGPU: boolean;
  onChangeUseWebGPU: (next: boolean) => void;
  customPalette: CustomPalette;
  onChangeCustomPalette: (next: CustomPalette) => void;
  editorProtocol: EditorProtocol;
  onChangeEditorProtocol: (next: EditorProtocol) => void;
  resumeOnRestore: boolean;
  onChangeResumeOnRestore: (next: boolean) => void;
}

type Tab = "toolbar" | "general" | "sessions";

export function SettingsDialog({
  open,
  onClose,
  buttons,
  onChangeButtons,
  font,
  onChangeFont,
  paletteId,
  onChangePaletteId,
  useWebGPU,
  onChangeUseWebGPU,
  customPalette,
  onChangeCustomPalette,
  editorProtocol,
  onChangeEditorProtocol,
  resumeOnRestore,
  onChangeResumeOnRestore,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("toolbar");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[640px] w-[760px] flex-col rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl"
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
              active={tab === "general"}
              onClick={() => setTab("general")}
            >
              General
            </SettingsNavItem>
            <SettingsNavItem
              active={tab === "sessions"}
              onClick={() => setTab("sessions")}
            >
              Sessions
            </SettingsNavItem>
          </nav>

          <div
            className={`flex-1 p-5 ${
              tab === "toolbar"
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
            {tab === "general" && (
              <GeneralSettings
                font={font}
                onChangeFont={onChangeFont}
                paletteId={paletteId}
                onChangePaletteId={onChangePaletteId}
                useWebGPU={useWebGPU}
                onChangeUseWebGPU={onChangeUseWebGPU}
                customPalette={customPalette}
                onChangeCustomPalette={onChangeCustomPalette}
                editorProtocol={editorProtocol}
                onChangeEditorProtocol={onChangeEditorProtocol}
              />
            )}
            {tab === "sessions" && (
              <SessionsSettings
                resumeOnRestore={resumeOnRestore}
                onChangeResumeOnRestore={onChangeResumeOnRestore}
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
  useWebGPU: boolean;
  onChangeUseWebGPU: (next: boolean) => void;
  customPalette: CustomPalette;
  onChangeCustomPalette: (next: CustomPalette) => void;
  editorProtocol: EditorProtocol;
  onChangeEditorProtocol: (next: EditorProtocol) => void;
}

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

function GeneralSettings({
  font,
  onChangeFont,
  paletteId,
  onChangePaletteId,
  useWebGPU,
  onChangeUseWebGPU,
  customPalette,
  onChangeCustomPalette,
  editorProtocol,
  onChangeEditorProtocol,
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

function SessionsSettings({
  resumeOnRestore,
  onChangeResumeOnRestore,
}: {
  resumeOnRestore: boolean;
  onChangeResumeOnRestore: (next: boolean) => void;
}) {
  const [status, setStatus] = useState<"idle" | "clearing" | "cleared">("idle");

  const onClear = async () => {
    setStatus("clearing");
    try {
      await invoke("session_clear");
      setStatus("cleared");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("idle");
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold tracking-tight">Sessions</h3>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Comportement au démarrage
        </h4>
        <label className="flex items-start gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-3">
          <input
            type="checkbox"
            checked={resumeOnRestore}
            onChange={(e) => onChangeResumeOnRestore(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-zinc-300"
          />
          <span>
            <span className="block text-sm text-zinc-200">
              Reprendre les sessions Claude Code (`ccd --resume`)
            </span>
            <span className="mt-0.5 block text-[11px] text-zinc-500">
              Quand activé, chaque pane Claude Code détecté en idle/waiting au
              moment de la sauvegarde rejouera `ccd --resume &lt;session_id&gt;`
              au prochain lancement. Désactivez pour démarrer chaque pane sur un
              shell vierge.
            </span>
          </span>
        </label>
      </section>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Persistance
        </h4>
        <p className="mb-3 text-[11px] text-zinc-500">
          La session courante (projets, onglets, splits, cwd) est sauvegardée
          automatiquement toutes les 30 secondes et restaurée au démarrage. Pour
          les panes Claude Code détectés en idle/waiting, la commande `ccd
          --resume &lt;session_id&gt;` est rejouée à la restauration si l'option
          ci-dessus est active.
        </p>
        <button
          onClick={onClear}
          disabled={status === "clearing"}
          className="rounded border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/70 disabled:opacity-50"
          type="button"
        >
          {status === "clearing"
            ? "Effacement…"
            : status === "cleared"
              ? "Session effacée"
              : "Effacer la session sauvegardée"}
        </button>
      </section>
    </div>
  );
}
