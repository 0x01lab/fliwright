import logo from '../../../media/brand/logo.svg';
import thinking from '../../../media/brand/mascot-thinking.svg';
import { cn } from '../lib/utils.js';

/** Decorative identity; adjacent text supplies the accessible status label. */
export function BrandMark({
  thinking: isThinking = false,
  className,
}: {
  thinking?: boolean;
  className?: string;
}): JSX.Element {
  return <img src={isThinking ? thinking : logo} alt="" aria-hidden="true" draggable={false} className={cn('brand-mark shrink-0', className)} />;
}
