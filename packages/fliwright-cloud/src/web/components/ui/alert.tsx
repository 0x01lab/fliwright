// Adapted from shadcn/ui (radix-mira); owned locally for the cloud console.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const alertVariants = cva(
  'relative flex flex-wrap items-center gap-2 rounded-lg border border-transparent px-3 py-2.5 text-xs break-words [&>svg]:size-4 [&>svg]:shrink-0',
  { variants: { variant: { default: 'bg-muted text-foreground', destructive: 'bg-destructive/10 text-destructive' } }, defaultVariants: { variant: 'default' } },
);
function Alert({ className, variant, asChild = false, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'div';
  return <Component data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
function AlertTitle({ className, ...props }: React.ComponentProps<'h5'>) {
  return <h5 data-slot="alert-title" className={cn('font-medium', className)} {...props} />;
}
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-xs text-muted-foreground', className)} {...props} />;
}
export { Alert, AlertTitle, AlertDescription };
