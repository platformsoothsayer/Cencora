export default function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between border-b border-line pb-3">
      <div>
        <h1 className="text-[20px] font-semibold text-navy">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
