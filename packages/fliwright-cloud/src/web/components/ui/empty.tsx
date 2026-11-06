// Adapted from shadcn/ui (radix-mira); owned locally for the cloud console.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

function Empty({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="empty" className={cn('flex min-w-0 flex-col items-center justify-center gap-3 px-5 py-12 text-center', className)} {...props} />;
}
function EmptyHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="empty-header" className={cn('flex max-w-sm flex-col items-center gap-2', className)} {...props} />;
}
function EmptyMedia({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="empty-media" className={cn('mb-1 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-6', className)} {...props} />;
}
function EmptyTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 data-slot="empty-title" className={cn('text-sm font-medium', className)} {...props} />;
}
function EmptyDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="empty-description" className={cn('text-xs text-muted-foreground', className)} {...props} />;
}
function EmptyContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="empty-content" className={cn('flex items-center gap-2', className)} {...props} />;
}
export { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent };
