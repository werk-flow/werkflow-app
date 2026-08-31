export default function MaintenanceLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Wartung wird geladen">
      <span className="sr-only">Wartung wird geladen.</span>
      <div className="h-9 animate-pulse rounded-md bg-muted" />
      <div className="h-16 animate-pulse rounded-lg bg-muted" />
      <div className="h-72 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
