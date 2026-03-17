import { useMemo, useState } from "react";
import type { VendorKey } from "../config/appConfig";
import { getVendorServices, type VendorService } from "../config/serviceCatalog";

function normalizeQuery(text: string) {
  return text.trim().toLowerCase();
}

export function ServicePicker(props: {
  vendor: VendorKey;
  currentServiceId: number;
  onPick: (service: VendorService) => void;
  compact?: boolean;
  buttonLabel?: string;
  buttonClassName?: string;
}) {
  const { vendor, currentServiceId, onPick, compact, buttonLabel, buttonClassName } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const services = useMemo(() => getVendorServices(vendor), [vendor]);
  const currentService = useMemo(
    () => services.find((service) => service.id === currentServiceId) ?? null,
    [currentServiceId, services],
  );

  const filtered = useMemo(() => {
    const normalized = normalizeQuery(query);
    if (!normalized) return services.slice(0, 60);

    const parts = normalized.split(/\s+/g).filter(Boolean);
    return services
      .filter((service) => {
        const haystack = normalizeQuery(
          `${service.id} ${service.name} ${service.category ?? ""} ${service.type ?? ""}`,
        );
        return parts.every((part) => haystack.includes(part));
      })
      .slice(0, 80);
  }, [query, services]);

  const canPick = services.length > 0;

  const trigger = (
    <button className={buttonClassName ?? "btn"} type="button" onClick={() => setOpen(true)} disabled={!canPick}>
      {buttonLabel ?? "從清單選擇"}
    </button>
  );

  return (
    <div>
      {!compact && (
        <div className="hint" style={{ marginTop: 6 }}>
          目前選擇：
          {currentService
            ? `${currentService.id} / ${currentService.name}`
            : currentServiceId > 0
              ? `serviceId ${currentServiceId}（不在目前清單中）`
              : "尚未選擇"}
        </div>
      )}

      {compact ? trigger : <div className="actions" style={{ marginTop: 8 }}>{trigger}</div>}

      {open ? (
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
            onClick={(event) => event.stopPropagation()}
          >
            <div className="card-hd">
              <div>
                <div className="card-title">選擇服務項目</div>
                <div className="card-desc">{vendor} 的服務清單。可用名稱、分類或 ID 搜尋。</div>
              </div>
              <button className="btn danger" type="button" onClick={() => setOpen(false)}>
                關閉
              </button>
            </div>

            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">搜尋</div>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="例如：taiwan like / facebook / 1234"
                  />
                  <div className="hint">最多顯示 80 筆結果。</div>
                </div>
                <div className="field">
                  <div className="label">目前清單數量</div>
                  <input value={services.length.toLocaleString("zh-TW")} readOnly />
                </div>
              </div>

              <div className="sep" />

              <div className="list">
                {filtered.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    className="item"
                    style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                    onClick={() => {
                      onPick(service);
                      setOpen(false);
                    }}
                  >
                    <div className="item-hd">
                      <div className="item-title">
                        {service.id} / {service.name}
                      </div>
                      <span className="tag">{service.category ?? "未分類"}</span>
                    </div>
                    <div className="hint">
                      {service.type ? `type: ${service.type} / ` : ""}
                      {service.rate != null ? `rate: ${service.rate} / ` : ""}
                      {service.min != null ? `min: ${service.min} / ` : ""}
                      {service.max != null ? `max: ${service.max}` : ""}
                    </div>
                  </button>
                ))}
                {filtered.length === 0 ? <div className="hint">找不到符合條件的服務。</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
