// Adapted from shadcn/ui (radix-mira); owned locally for the cloud console.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  'inline-flex shrink-0 no-underline hover:no-underline items-center justify-center whitespace-nowrap rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/80',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30',
        outline:
          'border-border bg-input/20 hover:bg-input/50 hover:text-foreground dark:bg-input/30',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary-hover',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-7 gap-1 px-2 [&_svg]:size-3.5',
        xs: 'h-5 gap-1 rounded-sm px-2 text-[10px] [&_svg]:size-2.5',
        sm: 'h-6 gap-1 px-2 [&_svg]:size-3',
        lg: 'h-8 gap-1 px-2.5 [&_svg]:size-4',
        icon: 'size-7 [&_svg]:size-3.5',
        'icon-xs': 'size-5 rounded-sm [&_svg]:size-2.5',
        'icon-sm': 'size-6 [&_svg]:size-3',
        'icon-lg': 'size-8 [&_svg]:size-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, type = 'button', ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={asChild ? undefined : type}
        data-slot="button"
        data-variant={variant ?? 'default'}
        data-size={size ?? 'default'}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
