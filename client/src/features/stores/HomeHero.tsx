/** The paprika pitch at the top of `/` and of every store page; the card below overlaps it (`-mt-14`). */
export function HomeHero() {
  return (
    // The one permitted decorative gradient in the app.
    <section className="-mx-4 rounded-b-card bg-[linear-gradient(180deg,var(--color-brand-500),var(--color-brand-deep))] text-white lg:mx-[calc(50%-50vw)]">
      <div className="mx-auto w-full max-w-md px-4 pb-[72px] pt-4 md:max-w-lg">
        <p className="eyebrow text-white">Campus pickup</p>
        <h1 className="mt-2 text-display font-extrabold leading-none tracking-[-0.02em]">
          Skip the queue.
        </h1>
        <p className="mt-3 max-w-sm text-base font-medium leading-relaxed text-white">
          Order ahead. We&rsquo;ll prepare it while you make your way.
        </p>
      </div>
    </section>
  );
}
