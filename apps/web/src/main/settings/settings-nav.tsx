import type { ComponentType } from "react";
import {
  ArrowLeftIcon,
  BotIcon,
  KeyboardIcon,
  LayersIcon,
  LogInIcon,
  PaletteIcon,
  Settings2Icon,
  MailIcon,
} from "lucide-react";
import type { SettingsPane } from "../gmail/api";
import { cn, HintTooltip } from "../gmail/ui";
import { useOtterAccount } from "../otter-account";
import { OtterAvatar } from "./otter-account-pane";

type SettingsSection = {
  id: SettingsPane;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = [
  { id: "general", label: "General", icon: Settings2Icon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "keybindings", label: "Keybindings", icon: KeyboardIcon },
  { id: "accounts", label: "Mailboxes", icon: MailIcon },
  { id: "views", label: "Views", icon: LayersIcon },
  { id: "assistant", label: "Assistant", icon: BotIcon },
];

export function settingsSectionLabel(pane: SettingsPane): string {
  if (pane === "otter") return "Otter account";
  return SETTINGS_SECTIONS.find((s) => s.id === pane)?.label ?? "Settings";
}

/** The mail sidebar's row (Codex): 14px regular text, muted icon, rounded pill. */
const ROW =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-(--sidebar-row-content-inset) text-left text-sm font-normal outline-none transition-[background-color,color] focus-visible:ring-2 focus-visible:ring-focus-ring active:bg-sidebar-row-active [&>svg]:size-4 [&>svg]:shrink-0";

const ROW_IDLE =
  "text-sidebar-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground [&>svg]:text-sidebar-muted-foreground hover:[&>svg]:text-sidebar-foreground";

/**
 * Sidebar contents while the settings page is open: sections, then Back and
 * the Otter account (a sign-in row, or the user's avatar), as in Otter Code.
 */
export function SettingsNav({
  pane,
  onSelect,
  onBack,
}: {
  pane: SettingsPane;
  onSelect: (pane: SettingsPane) => void;
  onBack: () => void;
}) {
  const otter = useOtterAccount();
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 scroll-fade-y overflow-y-auto px-(--sidebar-content-inset) pb-8 pt-3">
        <div className="flex h-8 items-center px-(--sidebar-row-content-inset) text-[13px] text-sidebar-muted-foreground">
          Settings
        </div>
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          const active = section.id === pane;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                ROW,
                active
                  ? "bg-sidebar-row-selected text-sidebar-foreground [&>svg]:text-sidebar-foreground"
                  : ROW_IDLE,
              )}
            >
              <Icon />
              <span className="truncate">{section.label}</span>
            </button>
          );
        })}
      </div>
      {/* Bottom rows, like Otter Code's settings sidebar. */}
      <div className="flex shrink-0 flex-col gap-0.5 px-(--sidebar-content-inset) py-1">
        {otter && !otter.user ? (
          <button
            type="button"
            onClick={() => onSelect("otter")}
            aria-current={pane === "otter" ? "page" : undefined}
            className={cn(ROW, pane === "otter" ? "bg-sidebar-row-selected" : ROW_IDLE)}
          >
            <LogInIcon />
            <span className="truncate">Sign in to Otter Mail</span>
          </button>
        ) : null}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            className={cn(ROW, "w-auto min-w-0 flex-1", ROW_IDLE)}
          >
            <ArrowLeftIcon />
            <span className="truncate">Back</span>
          </button>
          {otter?.user ? (
            <HintTooltip label={`${otter.user.name ?? otter.user.email} · Otter account`}>
              <button
                type="button"
                aria-label="Otter account"
                aria-current={pane === "otter" ? "page" : undefined}
                onClick={() => onSelect("otter")}
                className={cn(
                  "relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring",
                  pane === "otter" ? "bg-sidebar-row-selected" : "hover:bg-sidebar-row-hover",
                )}
              >
                <OtterAvatar user={otter.user} className="size-6" />
                {otter.realtime === "live" ? (
                  <span
                    aria-hidden
                    className="absolute bottom-1 right-1 size-2 rounded-full bg-primary ring-2 ring-sidebar-surface"
                  />
                ) : null}
              </button>
            </HintTooltip>
          ) : null}
        </div>
      </div>
    </>
  );
}
