import { setSyncedPreference } from "../synced-preferences";
import { Switch } from "~/components/ui/switch";
import { features } from "../features";
import { gmailApi } from "../gmail/api";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "../gmail/toast";
import type { NativeThemeInfo } from "@otter-mail/contracts";
import {
  CopyIcon,
  MoonIcon,
  PaintbrushIcon,
  PenLineIcon,
  PlusIcon,
  SunIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { cn, HintTooltip } from "../gmail/ui";
import {
  appearance,
  INITIAL_THEME_ID,
  setThemeForAppearance,
  themeColors,
  useAppThemes,
  useThemeChoice,
} from "../theme/apply-theme";
import {
  APP_THEMES,
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from "@otter-mail/shared/themes";
import { getThemeModes, removeCustomTheme, serializeThemeFile } from "../theme/themePalette";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { ThemeImportDialog } from "./theme/ThemeImportDialog";
import { useThemeEditorStore } from "./theme/themeEditorStore";
import {
  DEFAULT_PANEL_ANIMATION_DURATION_MS,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_PANEL_ANIMATION_DURATION_MS,
  setPanelAnimationDurationMs,
  usePanelAnimationDurationMs,
} from "../panel-animations";
import { PanelAnimationsPreview } from "./panel-animations-preview";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settings-ui";
import { searchableSetting } from "./settings-search";

export type ColorScheme = "system" | "light" | "dark";

// ---------------------------------------------------------------------------
// Color scheme cards: a miniature window painted with the chosen theme.
// ---------------------------------------------------------------------------

/** A tiny mail window (sidebar, list lines, bubble, composer) in one palette. */
function MiniWindow({ colors }: { colors: ThemeColors }) {
  const line = (width: string, extra?: CSSProperties) => (
    <span
      className="block h-1.5 rounded-full"
      style={{ width, backgroundColor: colors.textMuted, opacity: 0.35, ...extra }}
    />
  );
  return (
    <span className="flex size-full" style={{ backgroundColor: colors.canvas }}>
      <span
        className="flex w-[26%] flex-col gap-1.5 px-2 pt-2.5"
        style={{
          backgroundColor: colors.sidebar,
          borderRight: `1px solid ${colors.sidebarBorder}`,
        }}
      >
        <span
          className="block h-2 rounded-full"
          style={{
            backgroundColor: colors.sidebarRowSelected,
            border: `1px solid ${colors.border}`,
          }}
        />
        {line("80%")}
        {line("65%")}
        {line("72%")}
      </span>
      <span className="relative flex flex-1 flex-col gap-1.5 px-3 pt-3">
        <span className="flex justify-end">
          <span
            className="block h-3 w-[38%] rounded-full"
            style={{ backgroundColor: colors.messageSurface }}
          />
        </span>
        {line("62%")}
        {line("48%")}
        <span
          className="absolute inset-x-3 bottom-2.5 flex h-4 items-center justify-end rounded-full px-1"
          style={{ backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}` }}
        >
          <span
            className="block size-2.5 rounded-full"
            style={{ backgroundColor: colors.messageAction }}
          />
        </span>
      </span>
    </span>
  );
}

export function SchemeCard({
  scheme,
  selected,
  light,
  dark,
  onSelect,
}: {
  scheme: ColorScheme;
  selected: boolean;
  light: ThemeColors;
  dark: ThemeColors;
  onSelect: () => void;
}) {
  const label = scheme === "system" ? "System" : scheme === "light" ? "Light" : "Dark";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2 rounded-xl border bg-card p-2 pb-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring",
        selected
          ? "border-focus-ring text-foreground ring-1 ring-focus-ring"
          : "border-border/60 text-muted-foreground hover:border-input hover:text-foreground",
      )}
    >
      <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-lg border border-border/60">
        {scheme === "system" ? (
          <>
            <span className="absolute inset-0">
              <MiniWindow colors={light} />
            </span>
            <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
              <MiniWindow colors={dark} />
            </span>
          </>
        ) : (
          <MiniWindow colors={scheme === "light" ? light : dark} />
        )}
      </span>
      <span className={selected ? "font-medium" : undefined}>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Theme orbs (ported from Otter Code's ThemePreviewCircles).
// ---------------------------------------------------------------------------

const ORB_SPEC = {
  light: {
    baseTarget: "#ffffff",
    accent: { center: "72% 22%", middleOffset: 28, middleOpacity: 72, endOffset: 58 },
    action: { center: "18% 82%", startOpacity: 45, endOffset: 55 },
  },
  dark: {
    baseTarget: "#09090b",
    accent: { center: "28% 78%", middleOffset: 28, middleOpacity: 62, endOffset: 58 },
    action: { center: "82% 18%", startOpacity: 45, endOffset: 55 },
  },
} as const;

function orbStyle(colors: ThemeColors, mode: ThemeAppearance): CSSProperties {
  const spec = ORB_SPEC[mode];
  return {
    backgroundColor: `color-mix(in oklab, ${colors.canvas} 80%, ${spec.baseTarget})`,
    backgroundImage: [
      `radial-gradient(circle at ${spec.accent.center} in oklab, ${colors.accent} 0%, color-mix(in oklab, ${colors.accent} ${spec.accent.middleOpacity}%, transparent) ${spec.accent.middleOffset}%, transparent ${spec.accent.endOffset}%)`,
      `radial-gradient(circle at ${spec.action.center} in oklab, color-mix(in oklab, ${colors.messageAction} ${spec.action.startOpacity}%, transparent) 0%, transparent ${spec.action.endOffset}%)`,
    ].join(", "),
    filter: "blur(3px)",
    transform: "scale(1.1)",
  };
}

function ThemeOrb({
  theme,
  mode,
  picked,
  onPick,
}: {
  theme: ThemeDefinition;
  mode: ThemeAppearance;
  picked: boolean;
  onPick: () => void;
}) {
  const colors = themeColors(theme.id, mode);
  return (
    <HintTooltip label={mode === "light" ? "Use for light mode" : "Use for dark mode"}>
      <button
        type="button"
        aria-label={`Use ${theme.label} for ${mode} mode`}
        aria-pressed={picked}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
        className={cn(
          "relative flex size-[68px] shrink-0 cursor-pointer items-center justify-center rounded-full p-1 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-focus-ring",
          !picked && "hover:scale-105",
        )}
      >
        <span
          aria-hidden
          className="relative block size-14 overflow-hidden rounded-full border-2 border-canvas"
          style={{
            boxShadow:
              mode === "dark"
                ? "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)"
                : "inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)",
          }}
        >
          <span className="absolute inset-0 rounded-full" style={orbStyle(colors, mode)} />
        </span>
        {picked ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ boxShadow: "inset 0 0 0 2px var(--ring)" }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0.5 right-0.5 flex size-5 items-center justify-center rounded-full border border-border/70 bg-canvas text-foreground shadow-sm"
            >
              {mode === "light" ? <SunIcon className="size-3" /> : <MoonIcon className="size-3" />}
            </span>
          </>
        ) : null}
      </button>
    </HintTooltip>
  );
}

export function ThemeCard({
  theme,
  pickedModes,
  onPick,
  actions,
}: {
  theme: ThemeDefinition;
  pickedModes: ThemeAppearance[];
  onPick: (modes: ThemeAppearance[]) => void;
  /** Buttons by the label (Otter Code's Duplicate, Edit, Export, Remove). */
  actions?: ReactNode;
}) {
  const active = pickedModes.length > 0;
  // A theme of your own may have one palette only, as in Otter Code.
  const modes = (["light", "dark"] as const).filter((mode) =>
    getThemeColorsForAppearance(theme, mode),
  );
  const label =
    modes.length > 1
      ? `Use ${theme.label} for light and dark mode`
      : `Use ${theme.label} for ${modes[0]} mode`;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => onPick([...modes])}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick([...modes]);
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-xl border bg-card pb-3.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring",
        active ? "border-foreground/25" : "border-border/60 hover:border-input",
      )}
    >
      <div className="flex min-h-16 items-center justify-center gap-2.5 px-3 pt-3">
        {modes.map((mode) => (
          <ThemeOrb
            key={mode}
            theme={theme}
            mode={mode}
            picked={pickedModes.includes(mode)}
            onPick={() => onPick([mode])}
          />
        ))}
      </div>
      <div className="flex min-h-6 items-center gap-2 px-4">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{theme.label}</span>
        {actions ? (
          <span
            className="-me-2 flex shrink-0 items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {actions}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** One of a card's actions, as Otter Code's library cards have them. */
function ThemeAction({
  label,
  tooltip,
  onClick,
  destructive,
  children,
}: {
  label: string;
  tooltip: string;
  onClick: () => void;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            size="icon-xs"
            variant={destructive ? "ghost-destructive" : "ghost"}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

// Otter Code's (ThemeSettings.tsx).
function downloadThemeFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking synchronously can abort the download in some browsers; give the
  // browser time to open the stream first.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * The Themes grid, as Otter Code's theme library: every theme can be
 * duplicated into the editor (settings/theme, Otter Code's), your own can be
 * edited, exported as a file and removed, and themes come in from files
 * (Otter Code's and VS Code's).
 */
function ThemeLibrary() {
  const choice = useThemeChoice();
  const themes = useAppThemes();
  const openThemeEditor = useThemeEditorStore((store) => store.openThemeEditor);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [removing, setRemoving] = useState<ThemeDefinition | null>(null);

  // Wears a theme wherever it has a palette: a one-palette theme takes its own side only.
  const wear = (theme: ThemeDefinition) => {
    for (const mode of getThemeModes(theme)) setThemeForAppearance(mode, theme.id);
  };

  return (
    <SettingsSection
      {...searchableSetting("themes")}
      description="Click a theme to use it everywhere, or a single orb to use it for light or dark mode only. Duplicate one to make it your own."
      variant="plain"
      headerAction={
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              // Starts from what's on screen, as in Otter Code.
              openThemeEditor({
                editingThemeId: null,
                seedThemeId: choice[appearance()],
                seedName: null,
                initialAppearance: appearance(),
              })
            }
          >
            <PaintbrushIcon />
            Create theme
          </Button>
          <Button size="xs" variant="outline" onClick={() => setIsImportOpen(true)}>
            <PlusIcon />
            Add theme
          </Button>
        </div>
      }
    >
      <TooltipProvider>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {themes.map((theme) => {
            const custom = !APP_THEMES.includes(theme);
            return (
              <ThemeCard
                key={theme.id}
                theme={theme}
                pickedModes={(["light", "dark"] as const).filter((m) => choice[m] === theme.id)}
                onPick={(modes) => {
                  for (const mode of modes) setThemeForAppearance(mode, theme.id);
                }}
                actions={
                  <>
                    <ThemeAction
                      label={`Duplicate ${theme.label}`}
                      tooltip="Duplicate theme"
                      onClick={() =>
                        openThemeEditor({
                          editingThemeId: null,
                          seedThemeId: theme.id,
                          seedName: `${theme.label} copy`,
                          initialAppearance: appearance(),
                        })
                      }
                    >
                      <CopyIcon />
                    </ThemeAction>
                    {custom ? (
                      <>
                        <ThemeAction
                          label={`Edit ${theme.label}`}
                          tooltip="Edit theme"
                          onClick={() =>
                            openThemeEditor({
                              editingThemeId: theme.id,
                              seedThemeId: null,
                              seedName: null,
                              initialAppearance: appearance(),
                            })
                          }
                        >
                          <PenLineIcon />
                        </ThemeAction>
                        <ThemeAction
                          label={`Export ${theme.label}`}
                          tooltip="Export theme file"
                          onClick={() =>
                            downloadThemeFile(`${theme.id}.json`, serializeThemeFile(theme))
                          }
                        >
                          <UploadIcon />
                        </ThemeAction>
                        <ThemeAction
                          label={`Remove ${theme.label}`}
                          tooltip="Remove theme"
                          destructive
                          onClick={() => setRemoving(theme)}
                        >
                          <Trash2Icon />
                        </ThemeAction>
                      </>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </div>
      </TooltipProvider>
      <ThemeImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onImported={(imported) => {
          wear(imported);
          const modes = getThemeModes(imported);
          toast.success(`${imported.label} added`, {
            description:
              modes.length === 1 ? `It’s now your ${modes[0]} theme.` : "It’s now active.",
          });
          return true;
        }}
        onImportedMany={(imported, { updated }) => {
          const verb = updated ? "updated" : "added";
          toast.success(
            imported.length === 1
              ? `${imported[0]!.label} ${verb}`
              : `${imported.length} themes ${verb}`,
            { description: imported.map((theme) => theme.label).join(", ") },
          );
        }}
      />
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove “${removing?.label}”?`}
        description="It’s removed on all your devices. You can bring it back anytime by importing its JSON file."
        confirmLabel="Remove theme"
        confirmVariant="destructive"
        onConfirm={() => {
          if (!removing) return;
          // Whatever wore it goes back to the theme a fresh install wears.
          for (const mode of ["light", "dark"] as const) {
            if (choice[mode] === removing.id) setThemeForAppearance(mode, INITIAL_THEME_ID);
          }
          try {
            removeCustomTheme(removing.id);
          } catch {
            toast.error("Couldn’t remove theme", { description: "Try again." });
          }
        }}
      />
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

/** The app's color scheme (System, Light, Dark), and a setter that syncs it with the account. */
export function useColorScheme(): [ColorScheme, (next: ColorScheme) => Promise<void>] {
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);

  const refreshThemeInfo = async () => {
    try {
      setThemeInfo(await window.desktopBridge.nativeTheme.getInfo());
    } catch (error) {
      toast.error(`Failed to get theme info: ${error}`);
    }
  };
  useEffect(() => {
    void refreshThemeInfo();
  }, []);

  const scheme: ColorScheme = themeInfo?.themeSource ?? "system";
  const setScheme = async (next: ColorScheme) => {
    console.log("[Settings:setColorScheme]", { scheme: next });
    try {
      await window.desktopBridge.nativeTheme.setThemeSource(next);
      setSyncedPreference("otter:theme-source", next);
      await refreshThemeInfo();
    } catch (error) {
      toast.error(`Failed to set color scheme: ${error}`);
    }
  };
  return [scheme, setScheme];
}

/** Whether the Dock icon shows the unread count (Mac app), on by default. */
function useDockBadge(): [boolean, (next: boolean) => Promise<void>] {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    if (!features.dockBadge) return;
    gmailApi
      .getSyncSettings()
      .then((settings) => setEnabled(settings.dockBadgeEnabled))
      .catch((error) => toast.error(`Failed to load Dock badge setting: ${error}`));
  }, []);
  const set = async (next: boolean) => {
    setEnabled(next);
    console.log("[Settings:setDockBadgeEnabled]", { checked: next });
    try {
      await gmailApi.setSyncSettings({ dockBadgeEnabled: next });
    } catch (error) {
      setEnabled(!next);
      toast.error(`Failed to change Dock badge: ${error}`);
    }
  };
  return [enabled, set];
}

export function AppearancePane() {
  const choice = useThemeChoice();
  const [scheme, setScheme] = useColorScheme();
  const [dockBadge, setDockBadge] = useDockBadge();

  const panelAnimationDurationMs = usePanelAnimationDurationMs();
  const panelAnimationDurationRatio =
    (panelAnimationDurationMs - MIN_PANEL_ANIMATION_DURATION_MS) /
    (MAX_PANEL_ANIMATION_DURATION_MS - MIN_PANEL_ANIMATION_DURATION_MS);
  const panelAnimationDurationSliderStyle = {
    "--settings-slider-progress": `${panelAnimationDurationRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - panelAnimationDurationRatio}rem`,
  } as CSSProperties;

  const light = themeColors(choice.light, "light");
  const dark = themeColors(choice.dark, "dark");

  return (
    <SettingsPageContainer title="Appearance">
      <SettingsSection {...searchableSetting("color-scheme")} variant="plain">
        <div className="grid grid-cols-3 gap-3">
          {(["system", "light", "dark"] as const).map((s) => (
            <SchemeCard
              key={s}
              scheme={s}
              selected={scheme === s}
              light={light}
              dark={dark}
              onSelect={() => void setScheme(s)}
            />
          ))}
        </div>
      </SettingsSection>

      <ThemeLibrary />

      <SettingsSection title="Dock">
        <SettingsRow
          {...searchableSetting("dock-badge")}
          description={
            features.dockBadge
              ? "A badge with the number of unread messages in your inboxes."
              : "A badge with the number of unread messages in your inboxes. Available in the Mac app."
          }
          control={
            <Switch
              id="dockBadgeEnabled"
              checked={features.dockBadge && dockBadge}
              disabled={!features.dockBadge}
              onCheckedChange={(checked) => void setDockBadge(checked)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Motion">
        <SettingsRow
          {...searchableSetting("panel-animations")}
          description="Set how fast panels open and close."
          control={
            <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
              <PanelAnimationsPreview durationMs={panelAnimationDurationMs} />
              <div className="flex w-full items-center gap-3">
                <output
                  className="min-w-16 rounded-lg bg-muted px-2 py-1 text-center font-mono text-xs tabular-nums text-foreground"
                  htmlFor="panel-animation-duration"
                >
                  {panelAnimationDurationMs} ms
                </output>
                <input
                  aria-label="Panel animation duration"
                  className="settings-slider min-w-0 flex-1"
                  id="panel-animation-duration"
                  max={MAX_PANEL_ANIMATION_DURATION_MS}
                  min={MIN_PANEL_ANIMATION_DURATION_MS}
                  onChange={(event) =>
                    setPanelAnimationDurationMs(Number(event.currentTarget.value))
                  }
                  step={25}
                  style={panelAnimationDurationSliderStyle}
                  type="range"
                  value={panelAnimationDurationMs}
                />
              </div>
            </div>
          }
          resetAction={
            panelAnimationDurationMs !== DEFAULT_PANEL_ANIMATION_DURATION_MS ? (
              <SettingResetButton
                label="panel animations"
                onClick={() => setPanelAnimationDurationMs(DEFAULT_PANEL_ANIMATION_DURATION_MS)}
              />
            ) : null
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
