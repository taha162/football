/** Accessible 1–5 rating as a native radio group (works without JavaScript). */
export function RatingInput({ name, legend, required }: { name: string; legend: string; required?: boolean }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name={name} value={n} required={required} className="peer sr-only" />
            <span className="num flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2 font-semibold text-muted transition-colors peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {n}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
