import type { ComponentProps } from "react";
import { Select as Primitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn, restoreFocusForKeyboardOnly } from "./ui";

/**
 * Otter Code-style select (renderer-drawn, Radix underneath), replacing the
 * native popup. Trigger and popup follow T3's `SelectTrigger` / `SelectPopup` recipes.
 */

export const Select = Primitive.Root;

export function SelectTrigger({
  className,
  children,
  size: _size,
  variant: _variant,
  ...props
}: ComponentProps<typeof Primitive.Trigger> & { size?: string; variant?: string }) {
  return (
    <Primitive.Trigger
      className={cn(
        "relative inline-flex h-8 min-w-36 cursor-pointer select-none items-center justify-between gap-2 rounded-lg border border-border/70 bg-surface-raised/60 px-[calc(--spacing(2.75)-1px)] text-left text-sm text-foreground outline-none transition-[color,box-shadow,background-color] hover:bg-surface-raised focus-visible:border-focus-ring/60 focus-visible:ring-[3px] focus-visible:ring-focus-ring/16 data-[disabled]:pointer-events-none data-[disabled]:opacity-64 data-[placeholder]:text-placeholder",
        className,
      )}
      {...props}
    >
      {children}
      <Primitive.Icon asChild>
        <ChevronDownIcon className="-me-1 size-3.5 shrink-0 text-muted-foreground" />
      </Primitive.Icon>
    </Primitive.Trigger>
  );
}

export function SelectValue({ className, ...props }: ComponentProps<typeof Primitive.Value>) {
  return (
    <span className={cn("min-w-0 flex-1 truncate", className)}>
      <Primitive.Value {...props} />
    </span>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        position={position}
        sideOffset={4}
        onCloseAutoFocus={restoreFocusForKeyboardOnly}
        collisionPadding={8}
        className={cn(
          "dropdown-glass z-[130] max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-xl text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]",
          className,
        )}
        {...props}
      >
        <Primitive.Viewport className="p-1.5">{children}</Primitive.Viewport>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-lg py-1 pe-8 ps-2.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-64 data-[highlighted]:bg-foreground/[0.07]",
        className,
      )}
      {...props}
    >
      <Primitive.ItemText>{children}</Primitive.ItemText>
      <span className="absolute end-2.5 flex size-4 items-center justify-center">
        <Primitive.ItemIndicator>
          <CheckIcon className="size-4 text-foreground" />
        </Primitive.ItemIndicator>
      </span>
    </Primitive.Item>
  );
}
