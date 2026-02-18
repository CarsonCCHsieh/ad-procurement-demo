import type { ReactNode } from "react";
import { useMemo, useState } from "react";

type Accent = "blue" | "green" | "amber" | "slate";

function readOpen(storageKey: string): boolean | null {
  try {
    const v = localStorage.getItem(storageKey);
    if (v === "1") return true;
    if (v === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writeOpen(storageKey: string, open: boolean) {
  try {
    localStorage.setItem(storageKey, open ? "1" : "0");
  } catch {
    // ignore
  }
}

export function CollapsibleCard(props: {
  title: string;
  desc?: string;
  tag?: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  accent?: Accent;
  children: ReactNode;
}) {
  const { title, desc, tag, actions, defaultOpen, storageKey, accent, children } = props;

  const initial = useMemo(() => {
    if (storageKey) {
      const saved = readOpen(storageKey);
      if (saved != null) return saved;
    }
    return defaultOpen ?? true;
  }, [storageKey, defaultOpen]);

  const [open, setOpen] = useState<boolean>(initial);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (storageKey) writeOpen(storageKey, next);
      return next;
    });
  };

  const acc: Accent = accent ?? "slate";

  return (
    <div className={`card section section-${acc} ${open ? "is-open" : "is-closed"}`}>
      <div className="card-hd">
        <div>
          <div className="card-title">{title}</div>
          {desc ? <div className="card-desc">{desc}</div> : null}
        </div>

        <div className="section-right">
          {actions ? <div className="actions inline">{actions}</div> : null}
          {tag ? <span className="tag">{tag}</span> : null}
          <button className="btn ghost sm" type="button" onClick={toggle} aria-expanded={open}>
            {open ? "收合" : "展開"}
          </button>
        </div>
      </div>
      {open ? <div className="card-bd">{children}</div> : null}
    </div>
  );
}

