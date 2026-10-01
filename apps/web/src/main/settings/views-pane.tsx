import { useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { Text } from "~/components/ui/text";
import {
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useAccounts, useAllAccountLabels, useCombinedCounts } from "../gmail/hooks";
import { useMailViews } from "../gmail/custom-views";
import { ViewEditorForm } from "../gmail/view-editor-form";
import { getAccountColor, getAccountDisplayName } from "../gmail/account-style";
import { LabelChip } from "../gmail/label-chip";
import { SYSTEM_LABEL_NAMES } from "../gmail/label-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../gmail/menu";
import type { GmailAccount, GmailLabel, MailView } from "../gmail/types";
import { Btn, IconBtn } from "../gmail/ui";
import { SettingsGroup, SettingsPageContainer, SettingsRow } from "./settings-ui";
import { searchableSetting } from "./settings-search";

/**
 * Settings › Custom mailboxes (custom views): mailboxes made of filters, in
 * the rail after the real ones. Each row says what it shows (label chips,
 * accounts, live counts); editing opens the rule editor in place.
 */

const COMBINED_MAILBOX = "__combined__";

type LabelLookup = Map<string, Map<string, GmailLabel>>;

/** A label's shown name: system labels by their friendly name ("Inbox"). */
function nameOf(id: string, label: GmailLabel | undefined): string {
  if (!label || label.type === "system") return SYSTEM_LABEL_NAMES[id] ?? label?.name ?? id;
  return label.name.split("/").pop() ?? label.name;
}

/** Must-have labels (deduped by name across accounts) and must-not-have names. */
function ruleSummary(view: MailView, lookup: LabelLookup) {
  const include = new Map<string, GmailLabel>();
  const exclude = new Set<string>();
  for (const rule of view.rules ?? []) {
    const labels = lookup.get(rule.accountId);
    for (const id of rule.allOf) {
      const label = labels?.get(id);
      const name = nameOf(id, label);
      if (!include.has(name)) include.set(name, { ...(label ?? { id, type: "system" }), name });
    }
    for (const id of rule.noneOf) exclude.add(nameOf(id, labels?.get(id)));
  }
  return { include: [...include.values()], exclude: [...exclude] };
}

function ViewRow({
  view,
  accounts,
  lookup,
  showAccounts,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  view: MailView;
  accounts: GmailAccount[];
  lookup: LabelLookup;
  showAccounts: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const rules = view.rules ?? [];
  const counts = useCombinedCounts(rules, view.id);
  const { include, exclude } = ruleSummary(view, lookup);
  const ruleAccounts = accounts.filter((a) => rules.some((r) => r.accountId === a.id));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      data-slot="settings-row"
      className="group/row flex min-h-[60px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-foreground">{view.name}</span>
          {counts.data ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
              {counts.data.total.toLocaleString()}
              {counts.data.unread > 0 ? ` · ${counts.data.unread.toLocaleString()} unread` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {include.length === 0 ? (
            <span className="text-xs text-muted-foreground/80">All mail</span>
          ) : (
            include.map((label) => <LabelChip key={label.name} label={label} />)
          )}
          {exclude.map((name) => (
            <span
              key={name}
              className="inline-flex h-4.5 items-center rounded-sm border border-dashed border-input px-1 text-2xs font-medium leading-none text-muted-foreground/80"
            >
              not {name}
            </span>
          ))}
          {showAccounts && ruleAccounts.length > 0 ? (
            <span className="ms-1 inline-flex items-center gap-1 text-xs text-muted-foreground/70">
              <span className="text-muted-foreground/40">in</span>
              {ruleAccounts.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: getAccountColor(a) }}
                  />
                  {getAccountDisplayName(a)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
      <div
        data-slot="settings-row-control"
        className="flex shrink-0 items-center gap-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconBtn
              label={`More for ${view.name}`}
              className="opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
            >
              <EllipsisIcon className="size-4" />
            </IconBtn>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<PencilIcon />} onSelect={onEdit}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem icon={<CopyIcon />} onSelect={onDuplicate}>
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem color="red" icon={<Trash2Icon />} onSelect={onDelete}>
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ChevronRightIcon className="size-4 text-icon-muted" />
      </div>
    </div>
  );
}

export function ViewsPane({
  editingId,
  editingMailbox,
  onOpenView,
  onDone,
}: {
  editingId: string | null;
  editingMailbox: string | null;
  onOpenView: (viewId: string, mailbox: string) => void;
  onDone: () => void;
}) {
  const { views, saveView, deleteView, resetView } = useMailViews();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const accountLabels = useAllAccountLabels(accounts.map((a) => a.id));
  const [confirmDelete, setConfirmDelete] = useState<MailView | null>(null);

  if (editingId) {
    if (!accountsQuery.data) {
      return (
        <SettingsPageContainer>
          <p className="text-sm text-muted-foreground">Loading accounts…</p>
        </SettingsPageContainer>
      );
    }
    const editingView =
      editingId === "new" ? null : (views.find((v) => v.id === editingId) ?? null);
    // A custom mailbox can draw on every mailbox, whichever it was made in
    // (views were once each mailbox's own).
    const mailbox = editingView?.mailbox ?? editingMailbox ?? COMBINED_MAILBOX;
    return (
      <SettingsPageContainer>
        <ViewEditorForm
          key={editingId}
          view={editingView}
          accounts={accounts}
          onSave={(input) => saveView({ ...input, mailbox })}
          onDelete={deleteView}
          onReset={resetView}
          onDone={onDone}
        />
      </SettingsPageContainer>
    );
  }

  const lookup: LabelLookup = new Map(
    accountLabels.map((a) => [a.accountId, new Map(a.labels.map((l) => [l.id, l]))]),
  );
  const custom = views.filter((v) => v.kind === "custom");

  return (
    <SettingsPageContainer
      searchId={searchableSetting("views").id}
      title="Custom mailboxes"
      description="Mailboxes made of filters, across your mailboxes, in the rail after them. Each has its own Inbox, Starred, Sent and All Mail."
      action={
        <Btn size="sm" variant="outline" onClick={() => onOpenView("new", COMBINED_MAILBOX)}>
          <PlusIcon className="size-3.5" />
          New custom mailbox
        </Btn>
      }
    >
      <SettingsGroup>
        {custom.length === 0 ? (
          <SettingsRow
            title="No custom mailboxes yet"
            description="A custom mailbox is a saved filter, like “01 Action” across every account, or receipts from any of them."
          />
        ) : (
          custom.map((view) => (
            <ViewRow
              key={view.id}
              view={view}
              accounts={accounts}
              lookup={lookup}
              showAccounts={accounts.length > 1}
              onEdit={() => onOpenView(view.id, view.mailbox ?? COMBINED_MAILBOX)}
              onDuplicate={() =>
                void saveView({
                  name: `${view.name} copy`,
                  rules: view.rules ?? [],
                  mailbox: view.mailbox,
                })
              }
              onDelete={() => setConfirmDelete(view)}
            />
          ))
        )}
      </SettingsGroup>
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
        title={`Delete “${confirmDelete?.name ?? ""}”?`}
        confirmLabel="Delete mailbox"
        confirmVariant="accent"
        onConfirm={() => {
          if (confirmDelete) void deleteView(confirmDelete.id);
          setConfirmDelete(null);
        }}
      >
        <Text variant="small">
          The mailbox leaves the rail. Your mail and labels aren't touched.
        </Text>
      </Dialog>
    </SettingsPageContainer>
  );
}
