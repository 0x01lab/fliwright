// Adapted from shadcn/ui (radix-mira); owned locally for the cloud console.
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from './button.js';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} data-slot="dialog-overlay" className={cn('fixed inset-0 z-50 bg-black/50 backdrop-blur-sm', className)} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content ref={ref} data-slot="dialog-content" className={cn(
      'fixed top-1/2 left-1/2 z-50 grid max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-background p-4 text-xs text-foreground shadow-xl outline-none max-sm:max-h-[90dvh]',
      className,
    )} {...props}>{children}</DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5', className)} {...props} />;
}
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('flex flex-wrap items-center justify-end gap-2', className)} {...props} />;
}
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} data-slot="dialog-title" className={cn('text-base font-semibold', className)} {...props} />);
DialogTitle.displayName = DialogPrimitive.Title.displayName;
const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} data-slot="dialog-description" className={cn('text-xs text-muted-foreground', className)} {...props} />);
DialogDescription.displayName = DialogPrimitive.Description.displayName;

/** Controlled Cloud workflow composed from the shared shadcn dialog primitives. */
function CloudDialog({ title, description, children, onClose, busy = false, wide = false }: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const trigger = React.useRef(document.activeElement as HTMLElement | null);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent
      className={cn('gap-0 bg-card p-0', wide && 'max-w-3xl')}
      {...(!description ? { 'aria-describedby': undefined } : {})}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      onInteractOutside={event => { if (busy) event.preventDefault(); }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (trigger.current?.isConnected) trigger.current.focus();
      }}
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-card p-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Button variant="ghost" size="icon" aria-label="关闭对话框" disabled={busy} onClick={onClose}><X /></Button>
      </header>
      {children}
    </DialogContent>
  </Dialog>;
}

export { Dialog, DialogTrigger, DialogClose, DialogPortal, DialogOverlay, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, CloudDialog };
