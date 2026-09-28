import type { ComponentType } from "react";
import {
  ArrowLeftIcon,
  BotIcon,
  CircleUserRoundIcon,
  KeyboardIcon,
  LayersIcon,
  PaletteIcon,
  Settings2Icon,
  MailIcon,
} from "lucide-react";
import type { SettingsPane } from "../gmail/api";
import { cn } from "../gmail/ui";

type SettingsSection = {
  id: SettingsPane;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = [
  { id: "general", label: "General", icon: Settings2Icon },
  { id: "otter", label: "Account", icon: CircleUserRoundIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "keybindings", label: "Keybindings", icon: KeyboardIcon },
  { id: "accounts", label: "Mailboxes", icon: MailIcon },
  { id: "views", label: "Views", icon: LayersIcon },
  { id: "assistant", label: "Assistant", icon: BotIcon },
];

export function settingsSectionLabel(pane: SettingsPane): string {
  return SETTINGS_SECTIONS.find((s) => s.id === pane)?.label ?? "Settings";
}

/** The mail sidebar's row (Codex): 14px regular text, muted icon, rounded pill. */
const ROW =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-(--sidebar-row-content-inset) text-left text-sm font-normal outline-none transition-[background-color,color] focus-visible:ring-2 focus-visible:ring-focus-ring active:bg-sidebar-row-active [&>svg]:size-4 [&>svg]:shrink-0";

const ROW_IDLE =
  "text-sidebar-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground [&>svg]:text-sidebar-muted-foreground hover:[&>svg]:text-sidebar-foreground";

/** Sidebar contents while the settings page is open: the sections, then Back. */
export function SettingsNav({
  pane,
  onSelect,
  onBack,
}: {
  pane: SettingsPane;
  onSelect: (pane: SettingsPane) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 scroll-fade-y overflow-y-auto px-(--sidebar-content-inset) pb-8 pt-3">
        <h2 className="mb-1 flex h-8 items-center px-(--sidebar-row-content-inset) text-base font-semibold text-sidebar-foreground">
          Settings
        </h2>
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
      <div className="shrink-0 px-(--sidebar-content-inset) pt-1 pb-(--sidebar-content-inset)">
        <button type="button" onClick={onBack} className={cn(ROW, ROW_IDLE)}>
          <ArrowLeftIcon />
          <span className="truncate">Back</span>
        </button>
      </div>
    </>
  );
}
