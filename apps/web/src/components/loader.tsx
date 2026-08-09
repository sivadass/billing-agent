import type { SVGProps } from 'react';
import styles from './loader.module.scss';

const VIEWBOX_WIDTH = 32;
const VIEWBOX_HEIGHT = 33;

export type LoaderProps = {
  size: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox'>;

export function Loader({
  size,
  className,
  'aria-label': ariaLabel = 'Loading',
  ...rest
}: LoaderProps) {
  const height = size * (VIEWBOX_HEIGHT / VIEWBOX_WIDTH);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={height}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      {...rest}
    >
      <path
        fill="#843c3c"
        d="M32 7.776 24.224 0H8.3L16 8.075h8.224v8L32 23.85z"
        className={`${styles.logo} ${styles.top}`}
      />
      <path
        fill="#cb8383"
        d="m23.85 16.15-7.775-7.776H.15l7.7 8.075h8.225v8l7.776 7.775z"
        className={`${styles.logo} ${styles.bottom}`}
      />
    </svg>
  );
}
