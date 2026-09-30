import { useEffect, useState, type ComponentType } from "react";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CircleHelpIcon,
  CircleUserRoundIcon,
  KeyboardIcon,
  LayersIcon,
  PaletteIcon,
  Settings2Icon,
  MailIcon,
  MailCheckIcon,
  MousePointer2Icon,
  ScrollTextIcon,
} from "lucide-react";
import { changelogUrl } from "@otter-mail/shared/changelog";
import { gmailApi, type SettingsPane } from "../gmail/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../gmail/menu";
import { HintTooltip, IconBtn, cn } from "../gmail/ui";
import { features } from "../features";

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
  { id: "agents", label: "Agents", icon: MousePointer2Icon },
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
      <div className="flex shrink-0 flex-col gap-0.5 px-(--sidebar-content-inset) pt-1 pb-(--sidebar-content-inset)">
        {features.defaultMailApp ? <DefaultMailRow /> : null}
        <div className="flex items-center gap-1">
          <button type="button" onClick={onBack} className={cn(ROW, ROW_IDLE, "min-w-0 flex-1")}>
            <ArrowLeftIcon />
            <span className="truncate">Back</span>
          </button>
          <HelpMenu />
        </div>
      </div>
    </>
  );
}

/** The ? beside Back (Conductor's): links out, for now just the changelog on the site. */
function HelpMenu() {
  return (
    <DropdownMenu>
      <HintTooltip label="Help">
        <DropdownMenuTrigger asChild>
          <IconBtn label="Help">
            <CircleHelpIcon className="size-4" />
          </IconBtn>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent side="top">
        <DropdownMenuItem
          icon={<ScrollTextIcon />}
          onSelect={() => void window.desktopBridge.openExternal(changelogUrl())}
        >
          Changelog
          <ArrowUpRightIcon className="ms-1 inline size-3.5 align-[-2px]" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Shown only while Otter Mail isn't the Mac's default mail app: asks macOS
 * (a consent dialog) and hides once granted.
 */
function DefaultMailRow() {
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const refresh = async () => {
    try {
      setIsDefault((await gmailApi.getDefaultMailStatus()).isDefault);
    } catch (err) {
      console.log("[SettingsNav:defaultMailStatus] failed", { error: String(err) });
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  if (isDefault !== false) return null;
  return (
    <HintTooltip label="Use Otter Mail for email links">
      <button
        type="button"
        onClick={async () => {
          console.log("[SettingsNav:setDefaultMailApp]");
          try {
            await gmailApi.setDefaultMailApp();
          } catch (err) {
            console.log("[SettingsNav:setDefaultMailApp] failed", { error: String(err) });
          }
          void refresh();
        }}
        className={cn(ROW, ROW_IDLE)}
      >
        <MailCheckIcon />
        <span className="truncate">Set as default mail app</span>
      </button>
    </HintTooltip>
  );
}
