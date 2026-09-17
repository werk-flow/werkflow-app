import type { ComponentProps } from 'react';

/** Parkplatz links are outside this drag contract; preserve anchor semantics without the Next router runtime. */
export default function ParkingLink(props: ComponentProps<'a'>): React.JSX.Element {
  return <a {...props} />;
}
