import { useMemo, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./menu";
import { BanIcon, PlusIcon, XIcon } from "lucide-react";
import { LabelChip } from "./label-chip";
import { cn } from "./ui";
import { useAllAccountLabels, useCombinedCounts } from "./hooks";
import { defaultRulesFor } from "./custom-views";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { SYSTEM_LABEL_NAMES, SYSTEM_LABEL_ORDER, labelDisplayName } from "./label-names";
import type { GmailAccount, GmailLabel, MailView, ViewRule } from "./types";

/**
 * Making a view, or changing one, in a dialog over the mail (Smart
 * Mailbox-style): its name, then each mailbox's "Must have" / "Must not have"
 * labels, added from a menu. A view is a space in the rail: its list alone.
 */
type ViewEditorProps = {
  /** The view being edited; null when making one. */
  view: MailView | null;
  accounts: GmailAccount[];
  onSave: (input: { id?: string; name: string; rules: ViewRule[] }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onReset: (id: string) => Promise<unknown>;
  onClose: () => void;
};

type AccountPicks = { allOf: string[]; noneOf: string[] };
type Picks = Record<string, AccountPicks>;

function rulesToPicks(rules: ViewRule[]): Picks {
  const picks: Picks = {};
  for (const rule of rules)
    picks[rule.accountId] = { allOf: [...rule.allOf], noneOf: [...rule.noneOf] };
  return picks;
}

function picksToRules(picks: Picks): ViewRule[] {
  return Object.entries(picks)
    .filter(([, p]) => p.allOf.length > 0 || p.noneOf.length > 0)
    .map(([accountId, p]) => ({ accountId, allOf: p.allOf, noneOf: p.noneOf }));
}

function sortSystemLabels(labels: GmailLabel[]): GmailLabel[] {
  return labels
    .filter((l) => l.type === "system")
    .sort((a, b) => {
      const ai = SYSTEM_LABEL_ORDER.indexOf(a.id);
      const bi = SYSTEM_LABEL_ORDER.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
}

function chipName(label: GmailLabel | undefined, labelId: string): string {
  if (!label) return SYSTEM_LABEL_NAMES[labelId] ?? labelId;
  const display = labelDisplayName(label);
  return label.type === "user" ? (display.split("/").pop() ?? display) : display;
}

const EXCLUDED_CHIP =
  "group relative inline-flex h-4.5 w-fit max-w-40 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-dashed border-destructive/50 px-1 text-2xs font-medium leading-none text-destructive-foreground";

function RuleChip({
  label,
  labelId,
  excluded,
  onRemove,
}: {
  label: GmailLabel | undefined;
  labelId: string;
  excluded?: boolean;
  onRemove: () => void;
}) {
  const name = chipName(label, labelId);
  if (!excluded) {
    return <LabelChip label={label ?? { id: labelId, name, type: "system" }} onRemove={onRemove} />;
  }
  return (
    <span className={EXCLUDED_CHIP}>
      <BanIcon className="size-2.5" />
      <span className="min-w-0 truncate">{name}</span>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="cursor-pointer opacity-60 hover:opacity-100"
      >
        <XIcon className="size-2.5" />
      </button>
    </span>
  );
}

function AddLabelMenu({
  labels,
  usedIds,
  onPick,
}: {
  labels: GmailLabel[];
  usedIds: Set<string>;
  onPick: (labelId: string) => void;
}) {
  const user = labels.filter((l) => l.type === "user" && !usedIds.has(l.id));
  const system = sortSystemLabels(labels).filter((l) => !usedIds.has(l.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Add label"
          className="inline-flex h-4.5 cursor-pointer items-center gap-0.5 rounded-sm border border-dashed border-input px-1 text-2xs font-medium leading-none text-muted-foreground outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <PlusIcon className="size-2.5" />
          Label
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80">
        {user.length > 0 ? <DropdownMenuLabel>Labels</DropdownMenuLabel> : null}
        {user.map((label) => (
          <DropdownMenuItem key={label.id} onSelect={() => onPick(label.id)}>
            {labelDisplayName(label)}
          </DropdownMenuItem>
        ))}
        {user.length > 0 && system.length > 0 ? <DropdownMenuSeparator /> : null}
        {system.length > 0 ? <DropdownMenuLabel>Mailboxes</DropdownMenuLabel> : null}
        {system.map((label) => (
          <DropdownMenuItem key={label.id} onSelect={() => onPick(label.id)}>
            {labelDisplayName(label)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChipRow({
  title,
  labelIds,
  excluded,
  emptyHint,
  labels,
  usedIds,
  onAdd,
  onRemove,
}: {
  title: string;
  labelIds: string[];
  excluded?: boolean;
  emptyHint?: string;
  labels: GmailLabel[];
  usedIds: Set<string>;
  onAdd: (labelId: string) => void;
  onRemove: (labelId: string) => void;
}) {
  const byId = new Map(labels.map((l) => [l.id, l]));
  return (
    <div className="flex items-start gap-3">
      <span className="w-24 shrink-0 pt-0.5 text-[13px] text-muted-foreground">{title}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {labelIds.map((id) => (
          <RuleChip
            key={id}
            label={byId.get(id)}
            labelId={id}
            excluded={excluded}
            onRemove={() => onRemove(id)}
          />
        ))}
        {labelIds.length === 0 && emptyHint ? (
          <span className="pe-1 text-xs text-muted-foreground/60">{emptyHint}</span>
        ) : null}
        <AddLabelMenu labels={labels} usedIds={usedIds} onPick={onAdd} />
      </div>
    </div>
  );
}

/** The editor, open while `open`; mount it with a `key` per view (its fields start from it). */
export function ViewEditorDialog({
  open,
  view,
  accounts,
  onSave,
  onDelete,
  onReset,
  onClose,
}: ViewEditorProps & { open: boolean }) {
  const accountLabels = useAllAccountLabels(
    accounts.map((a) => a.id),
    open,
  );
  const anyLoading = accountLabels.some((a) => a.isLoading);

  const [name, setName] = useState(view?.name ?? "");
  const [picks, setPicks] = useState<Picks>(() =>
    rulesToPicks(view == null ? [] : (view.rules ?? defaultRulesFor(view.kind, accounts))),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isDefault = view != null && view.kind !== "custom";

  const update = (accountId: string, fn: (p: AccountPicks) => AccountPicks) => {
    setPicks((prev) => ({
      ...prev,
      [accountId]: fn(prev[accountId] ?? { allOf: [], noneOf: [] }),
    }));
  };

  const rules = useMemo(() => picksToRules(picks), [picks]);
  const draftCounts = useCombinedCounts(rules, `draft:${view?.id ?? "new"}`, open);

  const canSave = name.trim().length > 0 && rules.length > 0;
  // Mutations are optimistic: it closes at once; an error rolls back, with a toast.
  const save = () => void onSave({ id: view?.id, name: name.trim(), rules });

  const matchLine =
    rules.length === 0
      ? "Add a label to at least one mailbox"
      : draftCounts.data
        ? `${draftCounts.data.total.toLocaleString()} message${draftCounts.data.total === 1 ? "" : "s"}${
            draftCounts.data.unread > 0
              ? ` · ${draftCounts.data.unread.toLocaleString()} unread`
              : ""
          }`
        : "Counting…";

  return (
    <>
      <Dialog
        open={open && !confirmDelete}
        onOpenChange={(next) => {
          if (!next && !confirmDelete) onClose();
        }}
        size="xl"
        title={view ? `Edit “${view.name}”` : "New view"}
        description={
          isDefault
            ? "A folder of All mailboxes."
            : "Mail from your mailboxes, by their labels: a space in the rail, just its list."
        }
        confirmLabel={view ? "Save" : "Create view"}
        confirmDisabled={!canSave}
        onConfirm={save}
        destructiveAction={
          view && view.kind === "custom"
            ? { label: "Delete view", onClick: () => setConfirmDelete(true) }
            : undefined
        }
        secondaryAction={
          view && isDefault
            ? {
                label: "Reset to default",
                onClick: async () => {
                  await onReset(view.id);
                  onClose();
                },
              }
            : undefined
        }
      >
        <Field label="Name" orientation="vertical">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Action Required"
            autoFocus={view == null}
          />
        </Field>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="flex-1 text-[13px] font-medium text-foreground">
            Show mail that matches
          </span>
          <span
            className={cn(
              "text-xs tabular-nums",
              rules.length === 0 ? "text-muted-foreground/60" : "text-muted-foreground",
            )}
          >
            {matchLine}
          </span>
        </div>
        <div className="divide-y divide-border/60 rounded-xl border border-border/60">
          {accounts.length === 0 ? (
            <p className="px-4 py-3.5 text-[13px] text-muted-foreground">
              Add a mailbox (Settings › Mailboxes) to make a view.
            </p>
          ) : null}
          {accounts.map((account) => {
            const entry = accountLabels.find((a) => a.accountId === account.id);
            const labels = entry?.labels ?? [];
            const p = picks[account.id] ?? { allOf: [], noneOf: [] };
            const usedIds = new Set([...p.allOf, ...p.noneOf]);
            const included = p.allOf.length > 0 || p.noneOf.length > 0;
            return (
              <div key={account.id} className="space-y-2.5 px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: getAccountColor(account) }}
                  />
                  <span className="shrink-0 text-sm text-foreground">
                    {getAccountDisplayName(account)}
                  </span>
                  <span className="truncate text-[13px] text-muted-foreground">
                    {account.email}
                  </span>
                  {!included ? (
                    <span className="ms-auto shrink-0 text-2xs text-muted-foreground/60">
                      Not included
                    </span>
                  ) : null}
                </div>
                {labels.length === 0 && anyLoading ? (
                  <p className="text-xs text-muted-foreground/70">Loading labels…</p>
                ) : (
                  <div className="space-y-2">
                    <ChipRow
                      title="Must have"
                      labelIds={p.allOf}
                      emptyHint={p.noneOf.length > 0 ? "Any mail" : undefined}
                      labels={labels}
                      usedIds={usedIds}
                      onAdd={(id) =>
                        update(account.id, (cur) => ({ ...cur, allOf: [...cur.allOf, id] }))
                      }
                      onRemove={(id) =>
                        update(account.id, (cur) => ({
                          ...cur,
                          allOf: cur.allOf.filter((x) => x !== id),
                        }))
                      }
                    />
                    <ChipRow
                      title="Must not have"
                      labelIds={p.noneOf}
                      excluded
                      labels={labels}
                      usedIds={usedIds}
                      onAdd={(id) =>
                        update(account.id, (cur) => ({ ...cur, noneOf: [...cur.noneOf, id] }))
                      }
                      onRemove={(id) =>
                        update(account.id, (cur) => ({
                          ...cur,
                          noneOf: cur.noneOf.filter((x) => x !== id),
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[13px] text-muted-foreground">
          Mail must carry every “must have” label and none of the “must not have” ones. Results from
          each mailbox are combined.
        </p>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${view?.name ?? ""}”?`}
        confirmLabel="Delete view"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (view) await onDelete(view.id);
          setConfirmDelete(false);
          onClose();
        }}
      >
        <Text variant="small">The view leaves the rail. Your mail and labels aren't touched.</Text>
      </Dialog>
    </>
  );
}
