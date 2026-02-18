import { useMemo, useState } from "react";
import type { VendorKey } from "../config/appConfig";
import { getVendorServices, type VendorService } from "../config/serviceCatalog";

function norm(s: string) {
  return s.trim().toLowerCase();
}

export function ServicePicker(props: {
  vendor: VendorKey;
  currentServiceId: number;
  onPick: (svc: VendorService) => void;
}) {
  const { vendor, currentServiceId, onPick } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const services = useMemo(() => getVendorServices(vendor), [vendor]);

  const current = useMemo(() => services.find((s) => s.id === currentServiceId) ?? null, [services, currentServiceId]);

  const filtered = useMemo(() => {
    const query = norm(q);
    if (!query) return services.slice(0, 60);
    const parts = query.split(/\s+/g).filter(Boolean);
    const scored = services
      .map((s) => {
        const hay = norm(`${s.id} ${s.name} ${s.category ?? ""} ${s.type ?? ""}`);
        const ok = parts.every((p) => hay.includes(p));
        return ok ? s : null;
      })
      .filter((x): x is VendorService => x != null);
    return scored.slice(0, 80);
  }, [services, q]);

  return (
    <div>
      <div className="hint" style={{ marginTop: 6 }}>
        目前選擇：{current ? `${current.id} / ${current.name}` : currentServiceId > 0 ? `serviceId ${currentServiceId}（未在清單中）` : "未選擇"}
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <button className="btn" type="button" onClick={() => setOpen(true)} disabled={services.length === 0}>
          從清單挑選
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card"
            style={{ width: "min(980px, 100%)", maxHeight: "85vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-hd">
              <div>
                <div className="card-title">挑選 service（{vendor}）</div>
                <div className="card-desc">可用關鍵字搜尋：服務名稱、分類、ID。點選一列就會套用。</div>
              </div>
              <button className="btn danger" type="button" onClick={() => setOpen(false)}>
                關閉
              </button>
            </div>

            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">搜尋</div>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="例如：taiwan like / facebook / 1234" />
                  <div className="hint">顯示前 {filtered.length} 筆（最多 80）。</div>
                </div>
                <div className="field">
                  <div className="label">目前 service 清單筆數</div>
                  <input value={services.length.toLocaleString()} readOnly />
                </div>
              </div>

              <div className="sep" />

              <div className="list">
                {filtered.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="item"
                    style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                    onClick={() => {
                      onPick(s);
                      setOpen(false);
                    }}
                  >
                    <div className="item-hd">
                      <div className="item-title">
                        {s.id} / {s.name}
                      </div>
                      <span className="tag">{s.category ?? "uncategorized"}</span>
                    </div>
                    <div className="hint">
                      {s.type ? `type: ${s.type} / ` : ""}
                      {s.rate != null ? `rate: ${s.rate} / ` : ""}
                      {s.min != null ? `min: ${s.min} / ` : ""}
                      {s.max != null ? `max: ${s.max}` : ""}
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && <div className="hint">找不到符合的服務。</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

