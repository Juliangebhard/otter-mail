import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentToken, AgentTokens } from "@otter-mail/contracts/agent-tokens";
import { BotIcon, CopyIcon } from "lucide-react";

import { Dialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { toast } from "../gmail/toast";
import { Btn } from "../gmail/ui";
import { SettingsRow, SettingsSection, timeAgo } from "./settings-ui";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A value to hand an agent (an address, a token, a command), with Copy. */
export function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        readOnly
        onFocus={(e) => e.target.select()}
        className="font-mono text-xs"
      />
      <Btn
        size="sm"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => toast.success("Copied"))
        }
      >
        <CopyIcon className="size-3.5" />
        Copy
      </Btn>
    </div>
  );
}

/**
 * The tokens agents reach an MCP server with (contracts' agent-tokens.ts):
 * the relay's in Settings › Account, the Mac's in Settings › Agents. The
 * server's address, a row per token (last used, Revoke), and "New token…",
 * which shows the token once.
 */
export function AgentTokensSection<T extends AgentToken>({
  id,
  title,
  description,
  queryKey,
  list,
  create,
  revoke,
  defaultName,
  newTokenFields,
  renderControl,
  renderSetup,
}: {
  id?: string;
  title: string;
  description: ReactNode;
  /** The tokens' query; refreshed after every change. */
  queryKey: string;
  list: () => Promise<AgentTokens<T>>;
  /** Makes a token; answers the token itself. */
  create: (name: string) => Promise<string>;
  revoke: (id: string) => Promise<void>;
  defaultName: string;
  /** More to choose for a new token, below its name. */
  newTokenFields?: ReactNode;
  /** More controls on a token's row, before Revoke. */
  renderControl?: (token: T) => ReactNode;
  /** How to hand a new token to an agent, before the token itself. */
  renderSetup?: (url: string, token: string) => ReactNode;
}) {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: [queryKey], queryFn: list });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(defaultName);
  const [created, setCreated] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: [queryKey] });
  const remove = useMutation({
    mutationFn: revoke,
    onSuccess: refresh,
    onError: (err) => toast.error("Couldn't revoke the token", { description: errorText(err) }),
  });
  const url = tokens.data?.url ?? "";

  return (
    <SettingsSection
      id={id}
      title={title}
      description={description}
      headerAction={
        <Btn size="sm" onClick={() => setCreating(true)}>
          New token…
        </Btn>
      }
    >
      {tokens.data ? (
        <SettingsRow
          title="MCP server"
          description="Streamable HTTP; send the token as a Bearer token."
        >
          <div className="pb-2 pt-1">
            <CopyField value={url} />
          </div>
        </SettingsRow>
      ) : null}
      {tokens.isError ? (
        <SettingsRow title="Couldn't load your tokens" description={errorText(tokens.error)} />
      ) : (
        tokens.data?.tokens.map((token) => (
          <SettingsRow
            key={token.id}
            title={
              <span className="flex items-center gap-2">
                <BotIcon className="size-4 text-muted-foreground" />
                {token.name}
              </span>
            }
            description={token.lastUsedAt ? `Last used ${timeAgo(token.lastUsedAt)}` : "Never used"}
            control={
              <div className="flex items-center gap-2">
                {renderControl?.(token)}
                <Btn size="sm" disabled={remove.isPending} onClick={() => remove.mutate(token.id)}>
                  Revoke
                </Btn>
              </div>
            }
          />
        ))
      )}

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New agent token"
        confirmLabel="Create"
        confirmDisabled={!name.trim()}
        onConfirm={async () => {
          const token = await create(name.trim()).catch((err: unknown) => {
            toast.error("Couldn't make the token", { description: errorText(err) });
            throw err;
          });
          refresh();
          setCreated(token);
        }}
      >
        <Field label="Name" orientation="vertical">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {newTokenFields}
      </Dialog>

      <Dialog
        open={created != null}
        onOpenChange={(open) => {
          if (!open) setCreated(null);
        }}
        title="Your agent's token"
        confirmLabel="Done"
        onConfirm={() => setCreated(null)}
      >
        {created ? renderSetup?.(url, created) : null}
        <Text variant="small">
          Give your agent this token with the MCP server's address. It won't be shown again.
        </Text>
        <CopyField value={created ?? ""} />
      </Dialog>
    </SettingsSection>
  );
}
