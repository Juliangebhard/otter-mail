/**
 * A custom mailbox (a custom view in the rail) is one list: the view's mail.
 * Its sidebar has that (CUSTOM_ALL), then, where it's made of more than one
 * filter, each of them: the view's rules that take a label of that name (the
 * same name across mailboxes is one filter), or a whole mailbox's for a rule
 * without labels. Filters are named in the route, so their ids are their names.
 */

import { getAccountDisplayName } from "./account-style";
import { resolveRules } from "./custom-views";
import { useAllAccountLabels } from "./hooks";
import { SYSTEM_LABEL_NAMES, labelDisplayName } from "./label-names";
import type { GmailAccount, MailView, ViewRule } from "./types";

/** A custom mailbox's first row: all of its mail. */
export const CUSTOM_ALL = "all";

export type CustomMailboxFilter = {
  /** Its name, which is also its label id in the route. */
  id: string;
  name: string;
  /** The label's color, if it has one. */
  color: string | null;
  rules: ViewRule[];
};

/** The filters a custom mailbox is made of; none when it's only one (CUSTOM_ALL says it all). */
export function useCustomMailboxFilters(
  view: MailView | null,
  accounts: GmailAccount[],
): { filters: CustomMailboxFilter[]; loaded: boolean } {
  const rules = view ? resolveRules(view, accounts) : [];
  const accountLabels = useAllAccountLabels(
    [...new Set(rules.map((r) => r.accountId))],
    view != null,
  );
  const byName = new Map<string, CustomMailboxFilter>();
  const add = (name: string, color: string | null, rule: ViewRule) => {
    const filter = byName.get(name) ?? { id: name, name, color, rules: [] };
    if (!filter.rules.includes(rule)) filter.rules.push(rule);
    byName.set(name, filter);
  };
  for (const rule of rules) {
    if (rule.allOf.length === 0) {
      const account = accounts.find((a) => a.id === rule.accountId);
      add(account ? getAccountDisplayName(account) : rule.accountId, null, rule);
      continue;
    }
    const labels = accountLabels.find((a) => a.accountId === rule.accountId)?.labels ?? [];
    for (const id of rule.allOf) {
      const label = labels.find((l) => l.id === id);
      const name = !label
        ? (SYSTEM_LABEL_NAMES[id] ?? id)
        : label.type === "system"
          ? labelDisplayName(label)
          : (label.name.split("/").pop() ?? label.name);
      add(name, label?.color?.backgroundColor ?? null, rule);
    }
  }
  const filters = [...byName.values()];
  return {
    filters: filters.length > 1 ? filters : [],
    loaded: !accountLabels.some((a) => a.isLoading),
  };
}
