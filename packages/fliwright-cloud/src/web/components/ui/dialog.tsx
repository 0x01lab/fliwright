import React, { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button.js';
import { cn } from '../../lib/utils.js';

/** Native modal semantics provide focus containment, Escape and an inert background. */
export function Dialog({ title, description, children, onClose, busy = false, wide = false }: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const triggerRef = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = triggerRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={ref} className={cn('cloud-dialog', wide && 'cloud-dialog-wide')}
    aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => {
      if (busy || event.target !== ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="cloud-dialog-heading">
      <div><h2 id={`${id}-title`}>{title}</h2>{description && <p id={`${id}-description`} className="hint mt-1">{description}</p>}</div>
      <Button variant="ghost" size="icon" aria-label="关闭对话框" disabled={busy} onClick={onClose}><X className="size-4" /></Button>
    </header>
    {children}
  </dialog>;
}
