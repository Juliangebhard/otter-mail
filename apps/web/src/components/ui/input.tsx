import type * as React from "react";

import { cn } from "~/lib/utils";

/** Single-line text field: a quiet filled well with a faint border and a soft focus ring. */
function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-border/70 bg-surface-raised/60 px-[calc(--spacing(2.75)-1px)] text-sm text-foreground outline-none transition-[box-shadow,border-color,background-color] placeholder:text-placeholder focus-visible:border-focus-ring/60 focus-visible:bg-canvas focus-visible:ring-[3px] focus-visible:ring-focus-ring/16 disabled:opacity-64 aria-invalid:border-destructive/36",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
