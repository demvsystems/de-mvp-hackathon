export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col items-start gap-6 px-16 py-32">
        <h1 className="text-3xl leading-10 font-semibold tracking-tight text-black dark:text-zinc-50">
          Playground
        </h1>
        <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Build a UI here to generate data for <code className="font-mono">@repo/web</code>. Edit{' '}
          <code className="font-mono">app/page.tsx</code> to start.
        </p>
      </main>
    </div>
  );
}
