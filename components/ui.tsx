import type { Field } from "@/lib/extract";

export function Card({ title, aside, children, className = "" }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border border-line bg-white ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-line bg-alt px-3 py-2">
          <h2 className="text-[12px] font-semibold tracking-wide text-blue uppercase">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function ConfidenceChip({ value }: { value: number | null }) {
  if (value === null)
    return <span className="inline-block w-11 border border-line px-1 py-px text-center font-mono text-[11px] text-muted">n/a</span>;
  const cls =
    value >= 1
      ? "border-navy bg-navy text-white"
      : value >= 0.9
        ? "border-blue bg-blue text-white"
        : value >= 0.75
          ? "border-lightblue bg-white text-navy"
          : "border-amber bg-white text-amber";
  return <span className={`inline-block w-11 border px-1 py-px text-center font-mono text-[11px] ${cls}`}>{value.toFixed(2)}</span>;
}

export function FieldValue({ f, className = "" }: { f: Field; className?: string }) {
  if (f.value === null) return <span className={`italic text-muted ${className}`}>not sent by vendor</span>;
  if (f.value === "") return <span className={`italic text-muted ${className}`}>label sent, no value</span>;
  return <span className={className}>{f.value}</span>;
}

export function SourceBadge({ source }: { source: "rfi" | "synthesized" }) {
  return source === "rfi" ? (
    <span className="inline-block border border-navy px-1.5 py-px text-[11px] font-medium text-navy">From your RFI appendix</span>
  ) : (
    <span className="inline-block border border-line px-1.5 py-px text-[11px] text-muted">Synthesized in the same template</span>
  );
}

export function Btn({
  children,
  onClick,
  primary,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`border px-3 py-1.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
        primary ? "border-navy bg-navy text-white hover:bg-blue hover:border-blue" : "border-line bg-white text-navy hover:bg-card"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex border border-line">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1 text-[12px] ${i > 0 ? "border-l border-line" : ""} ${o.value === value ? "bg-navy font-medium text-white" : "bg-white text-navy hover:bg-card"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Amber callout. Reserved for a decision Cencora has to make, or a failure. */
export function Amber({ kind, children }: { kind: "decision" | "failure"; children: React.ReactNode }) {
  return (
    <div className="border border-amber border-l-[3px] bg-white px-3 py-2 text-[12px] text-ink">
      <span className="mr-2 font-semibold text-amber uppercase tracking-wide text-[11px]">{kind === "decision" ? "Decision for Cencora" : "Failure"}</span>
      {children}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <div className="border border-line border-l-[3px] border-l-blue bg-card px-3 py-2 text-[12px] text-ink">{children}</div>;
}

export function Stat({ label, value, tone = "navy" }: { label: string; value: React.ReactNode; tone?: "navy" | "amber" | "muted" }) {
  const c = tone === "amber" ? "text-amber" : tone === "muted" ? "text-muted" : "text-navy";
  return (
    <div className="px-4 py-2">
      <div className={`font-mono text-[22px] font-semibold leading-tight ${c}`}>{value}</div>
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
    </div>
  );
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-line bg-white px-2 py-1 text-[12px] text-ink">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
