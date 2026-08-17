import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

type LabelProps = ComponentProps<'label'>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      data-slot="label"
      className={cn(
        'text-xs font-medium tracking-wide text-foreground',
        className,
      )}
      {...props}
    />
  );
}
