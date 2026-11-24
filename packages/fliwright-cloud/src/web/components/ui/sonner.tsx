// Adapted from shadcn/ui (radix-mira); uses the Cloud theme.
import React, { type CSSProperties } from 'react';
import { CircleCheck, OctagonX } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

export function Toaster({ theme, bottomOffset }: { theme: ToasterProps['theme']; bottomOffset: number }) {
  return <Sonner
    theme={theme}
    position="bottom-right"
    offset={{ bottom: bottomOffset, right: 16 }}
    mobileOffset={{ bottom: bottomOffset, left: 12, right: 12 }}
    containerAriaLabel="操作通知"
    className="toaster group"
    icons={{ success: <CircleCheck className="size-4 text-pass-ink" />, error: <OctagonX className="size-4 text-destructive" /> }}
    style={{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
    } as CSSProperties}
  />;
}
