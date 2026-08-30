export default function ServiceCaseLoading() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="Servicefall wird geladen"
    >
      <span className="sr-only">Servicefall wird geladen.</span>
      <div className="h-9 animate-pulse rounded-md bg-muted" />
      <div className="h-24 animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
        <div className="h-72 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}
