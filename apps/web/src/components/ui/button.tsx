import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Push button in the app's control style (adapted from Otter Code's
 * components/ui/button.tsx): rounded pill, faint border, one flat solid
 * primary. `accent` is the solid call to action.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-normal outline-none transition-[box-shadow,scale,background-color] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "outline" },
    variants: {
      variant: {
        accent: "border-transparent bg-primary text-primary-foreground hover:bg-primary/88",
        destructive: "border-transparent bg-destructive text-white hover:bg-destructive/88",
        outline: "border-border bg-transparent text-foreground hover:bg-accent-surface",
        ghost: "border-transparent text-foreground hover:bg-accent-surface",
      },
      size: {
        small:
          "h-7 px-[calc(--spacing(2.5)-1px)] text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-8 px-[calc(--spacing(3)-1px)] text-sm [&_svg:not([class*='size-'])]:size-4",
        large: "h-9 px-[calc(--spacing(3.5)-1px)] text-sm [&_svg:not([class*='size-'])]:size-4",
      },
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
