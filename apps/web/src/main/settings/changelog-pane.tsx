import { ArrowUpRightIcon } from "lucide-react";
import { changelogUrl } from "@otter-mail/shared/changelog";
import { ChangelogArticle, useChangelog } from "../changelog";
import { Btn, cn } from "../gmail/ui";
import { SettingsPageContainer } from "./settings-ui";

/** Settings → What's new: every release this build knows, newest first. */
export function ChangelogPane() {
  const { entries, current } = useChangelog();
  return (
    <SettingsPageContainer
      title="What's new"
      description={current ? `You're on Otter Mail ${current}.` : undefined}
      action={
        <Btn
          size="sm"
          variant="ghost-muted"
          onClick={() => void window.desktopBridge.openExternal(changelogUrl())}
        >
          On the web
          <ArrowUpRightIcon />
        </Btn>
      }
    >
      {entries.map((entry, i) => (
        <div key={entry.version} className={cn(i > 0 && "border-t border-border/50 pt-10")}>
          <ChangelogArticle entry={entry} />
        </div>
      ))}
    </SettingsPageContainer>
  );
}
