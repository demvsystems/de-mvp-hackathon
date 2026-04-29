import { WorkersDashboard } from '@/components/admin/workers-dashboard';

export const dynamic = 'force-dynamic';

export default function AdminWorkersPage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold">Workers</h1>
        <p className="text-muted-foreground text-sm">
          Pause/resume each backend subscriber. Reset deletes the JetStream consumer and replays
          from the beginning.
        </p>
      </div>
      <WorkersDashboard />
    </main>
  );
}
