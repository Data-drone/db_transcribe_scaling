import { lazy, Suspense, type ComponentProps } from 'react';

/** ECharts is large; charts load on first use so the rest of the app starts quickly. */
const load = () => import('./charts');
const Volume = lazy(() => load().then((m) => ({ default: m.VolumeChart })));
const Reason = lazy(() => load().then((m) => ({ default: m.ReasonChart })));
const Tracking = lazy(() => load().then((m) => ({ default: m.TrackingChart })));

const Placeholder = ({ height }: { height: number }) => <i className="sk-block" style={{ height }} aria-hidden="true" />;

export function VolumeChart(props: ComponentProps<typeof Volume>) {
  return (
    <Suspense fallback={<Placeholder height={230} />}>
      <Volume {...props} />
    </Suspense>
  );
}
export function ReasonChart(props: ComponentProps<typeof Reason>) {
  return (
    <Suspense fallback={<Placeholder height={200} />}>
      <Reason {...props} />
    </Suspense>
  );
}
export function TrackingChart(props: ComponentProps<typeof Tracking>) {
  return (
    <Suspense fallback={<Placeholder height={180} />}>
      <Tracking {...props} />
    </Suspense>
  );
}
