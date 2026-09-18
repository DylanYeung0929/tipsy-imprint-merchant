export function PageHeader({ en, title, desc }: { en: string; title: string; desc?: string }) {
  return (
    <header className="mb-8">
      <p className="display-en text-xs text-amber-400">{en}</p>
      <h1 className="mt-1 text-3xl font-semibold text-stone-100">{title}</h1>
      {desc && <p className="mt-2 max-w-2xl text-sm text-stone-500">{desc}</p>}
    </header>
  );
}
