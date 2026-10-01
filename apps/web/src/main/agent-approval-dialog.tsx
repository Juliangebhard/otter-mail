import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AGENT_APPROVALS_CHANNEL, allowQuestion, type AgentApproval } from "@otter-mail/contracts";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { gmailApi } from "./gmail/api";
import { toast } from "./gmail/toast";

const KEY = ["mcp:approvals"];

/** What agents on the Mac wait on the user to allow, oldest first. */
function useAgentApprovals(): AgentApproval[] {
  const qc = useQueryClient();
  useEffect(
    () =>
      window.desktopBridge.on(AGENT_APPROVALS_CHANNEL, (approvals) =>
        qc.setQueryData(KEY, approvals),
      ),
    [qc],
  );
  return useQuery({ queryKey: KEY, queryFn: gmailApi.connectedAgentApprovals }).data ?? [];
}

/**
 * A change an agent on this Mac (Claude Code, Cursor, …) waits on the user to
 * allow. It has no chat in Otter Mail to ask in, so the main window asks, one
 * at a time. It can open while the user types, so Deny has the focus: a stray
 * ↩ never allows anything.
 */
export function AgentApprovalDialog() {
  const approvals = useAgentApprovals();
  const approval = approvals[0];
  if (!approval) return null;
  return <ApprovalDialog key={approval.id} approval={approval} waiting={approvals.length} />;
}

function ApprovalDialog({ approval, waiting }: { approval: AgentApproval; waiting: number }) {
  const [responding, setResponding] = useState(false);
  const respond = (decision: "once" | "deny") => {
    if (responding) return;
    setResponding(true);
    gmailApi.agentRespondApproval({ approvalId: approval.id, decision }).catch((err: unknown) => {
      setResponding(false);
      toast.error("Couldn't answer the agent", {
        description: err instanceof Error ? err.message : String(err),
      });
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) respond("deny");
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{allowQuestion(approval.agent, approval.title)}</DialogTitle>
          <DialogDescription className="max-h-60 overflow-y-auto whitespace-pre-line [overflow-wrap:anywhere]">
            {approval.detail}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {waiting > 1 ? (
            <span className="mr-auto self-center text-xs text-muted-foreground tabular-nums">
              1 of {waiting}
            </span>
          ) : null}
          <Button disabled={responding} onClick={() => respond("deny")}>
            Deny
          </Button>
          <Button variant="accent" disabled={responding} onClick={() => respond("once")}>
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
