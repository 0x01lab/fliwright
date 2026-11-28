import type { ReactNode } from 'react';
import { Card, CardFooter, CardHeader } from './components/ui/card.js';

export function ListCard({ heading, pageHeading, controls, footer, children }: {
  heading: ReactNode;
  pageHeading?: boolean;
  controls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return <Card className="min-w-0 overflow-hidden [&_tr>:first-child]:pl-3 [&_tr>:last-child]:pr-3">
    <CardHeader data-ui={pageHeading ? 'project-page-heading' : undefined} className="min-h-12 flex-row flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
      {heading}
      {controls && <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{controls}</div>}
    </CardHeader>
    {children}
    {footer && <CardFooter className="justify-center border-t border-border p-2">{footer}</CardFooter>}
  </Card>;
}
