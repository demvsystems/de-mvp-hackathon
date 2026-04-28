import { TemplateInspector } from '@/components/fixture-generator/template-inspector';

export default function FixtureGeneratorPage() {
  return (
    <div className="bg-background mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Fixture Generator</h1>
        <p className="text-muted-foreground text-sm">
          Phase 1: template loading and metadata inspection.
        </p>
      </header>
      <TemplateInspector />
    </div>
  );
}
