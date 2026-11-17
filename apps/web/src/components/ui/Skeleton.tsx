/** A loading placeholder. Pulses only when the user allows motion. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-border ${className}`} />;
}

export function PageLoading() {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
