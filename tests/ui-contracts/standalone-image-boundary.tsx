// `next/image` for the standalone screen's logo in the contract bundle, which
// has no Next.js image loader or its build-time environment.
import type { ImageProps } from 'next/image';

export default function Image({ src, alt, width, height, className }: ImageProps): React.JSX.Element {
  const plainSrc = typeof src === 'string' ? src : '';
  // eslint-disable-next-line @next/next/no-img-element -- the contract bundle has no image optimizer
  return <img src={plainSrc} alt={alt} width={width} height={height} className={className} />;
}
