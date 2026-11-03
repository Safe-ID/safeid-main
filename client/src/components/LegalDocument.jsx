export default function LegalDocument({ eyebrow, title, intro, sections, onBack }) {
  return (
    <div className="w-full max-w-3xl mx-auto pt-10 px-6 pb-20 animate-slide-up">
      <button
        type="button"
        onClick={onBack}
        className="bg-transparent border border-safe-border rounded-lg text-safe-dim py-2 px-4 text-sm cursor-pointer transition-colors hover:bg-safe-hover hover:text-safe-muted mb-8"
      >
        ← Voltar
      </button>

      <div className="text-safe-dim text-xs font-semibold tracking-widest mb-2">{eyebrow}</div>
      <h1 className="text-safe-text text-3xl font-bold tracking-tight font-[system-ui,sans-serif] mb-3">
        {title}
      </h1>
      <p className="text-safe-muted text-base leading-relaxed mb-10">{intro}</p>

      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <section key={section.title} className="bg-safe-card border border-safe-border rounded-2xl p-6">
            <h2 className="text-safe-text font-semibold text-lg mb-3">{section.title}</h2>
            {section.body?.map((paragraph) => (
              <p key={paragraph} className="text-safe-muted text-sm leading-relaxed mb-2 last:mb-0 [overflow-wrap:anywhere]">{paragraph}</p>
            ))}
            {section.items && (
              <ul className="flex flex-col gap-2 list-disc pl-5 text-safe-muted text-sm leading-relaxed">
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
            {section.after && <p className="text-safe-dim text-sm leading-relaxed mt-3">{section.after}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
