import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PRICING, calcLineAmount, type AdPlacement } from "../lib/pricing";
import { isValidUrl, parseLinks } from "../lib/validate";

type OrderKind = "new" | "upsell";

type LineItem = {
  placement: AdPlacement;
  target: string; // keep as string for input control
};

type FormState = {
  orderNo: string;
  caseName: string;
  kind: OrderKind;
  linksRaw: string;
  items: LineItem[];
};

type FormErrors = Partial<Record<keyof FormState, string>> & {
  items?: Array<{ placement?: string; target?: string }>;
};

function nowString() {
  return new Date().toLocaleString("zh-TW");
}

function defaultState(): FormState {
  return {
    orderNo: "",
    caseName: "",
    kind: "new",
    linksRaw: "",
    items: [{ placement: "fb_like", target: "100" }],
  };
}

function validate(state: FormState): FormErrors {
  const errors: FormErrors = {};

  if (!state.orderNo.trim()) errors.orderNo = "請填寫委刊單號";
  if (!state.caseName.trim()) errors.caseName = "請填寫案件名稱";

  const links = parseLinks(state.linksRaw);
  if (links.length === 0) {
    errors.linksRaw = "請至少提供 1 個連結";
  } else if (!links.every(isValidUrl)) {
    errors.linksRaw = "連結格式需為完整 URL（建議一行一個，例如 https://...）";
  }

  if (!state.items || state.items.length === 0) {
    errors.items = [{ placement: "請至少新增 1 筆投放項目" }];
  } else {
    errors.items = state.items.map((it) => {
      const e: { placement?: string; target?: string } = {};
      if (!it.placement) e.placement = "請選擇投放類型";
      const n = Number(it.target);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        e.target = "請輸入正整數";
      } else {
        const rule = PRICING[it.placement];
        if (n % rule.minUnit !== 0) {
          e.target = `數量需為 ${rule.minUnit.toLocaleString()} 的倍數`;
        }
      }
      return e;
    });
    if (errors.items.every((x) => !x.placement && !x.target)) {
      delete errors.items;
    }
  }

  return errors;
}

export function AdOrdersPage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();

  const [step, setStep] = useState<"edit" | "confirm" | "submitted">("edit");
  const [state, setState] = useState<FormState>(() => defaultState());
  const [errors, setErrors] = useState<FormErrors>({});

  const computed = useMemo(() => {
    const lineAmounts = state.items.map((it) => {
      const n = Number(it.target);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return calcLineAmount(it.placement, n);
    });
    const total = lineAmounts.reduce((a, b) => a + b, 0);
    return { lineAmounts, total };
  }, [state.items]);

  const toConfirm = () => {
    const e = validate(state);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setStep("confirm");
  };

  const onConfirmSubmit = () => {
    // MVP checkpoint: confirm-submit flow exists. No backend/API yet.
    setStep("submitted");
  };

  const applicant = user?.displayName ?? user?.username ?? "";
  const links = parseLinks(state.linksRaw);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">
            {step === "edit" ? "廣告下單" : step === "confirm" ? "確認送出" : "已送出（Demo）"}
          </div>
          <div className="brand-sub">表單 → 確認頁 → 送出（尚未串接 API）</div>
        </div>

        <div className="pill">
          <span className="tag">{applicant}</span>
          <button className="btn" onClick={() => nav("/ad-performance")}>
            成效頁
          </button>
          <button
            className="btn danger"
            onClick={() => {
              signOut();
              nav("/login", { replace: true });
            }}
          >
            登出
          </button>
        </div>
      </div>

      {step === "edit" && (
        <div className="grid">
          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">基本資訊</div>
                <div className="card-desc">申請人與日期由系統帶入（Demo）。</div>
              </div>
              <span className="tag">#/ad-orders</span>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">申請人</div>
                  <input value={applicant} readOnly />
                </div>
                <div className="field">
                  <div className="label">日期</div>
                  <input value={nowString()} readOnly />
                </div>
                <div className="field">
                  <div className="label">
                    委刊單號<span className="req">*</span>
                  </div>
                  <input
                    value={state.orderNo}
                    onChange={(e) => setState((s) => ({ ...s, orderNo: e.target.value }))}
                    placeholder="例如：202509230021"
                  />
                  {errors.orderNo && <div className="error">{errors.orderNo}</div>}
                </div>
                <div className="field">
                  <div className="label">
                    案件名稱<span className="req">*</span>
                  </div>
                  <input
                    value={state.caseName}
                    onChange={(e) => setState((s) => ({ ...s, caseName: e.target.value }))}
                    placeholder="例如：2025_DY_GAP(封面專案)"
                  />
                  {errors.caseName && <div className="error">{errors.caseName}</div>}
                </div>
                <div className="field">
                  <div className="label">
                    種類<span className="req">*</span>
                  </div>
                  <select
                    value={state.kind}
                    onChange={(e) => setState((s) => ({ ...s, kind: e.target.value as OrderKind }))}
                  >
                    <option value="new">新案</option>
                    <option value="upsell">加購</option>
                  </select>
                </div>
                <div className="field" />

                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">
                    連結<span className="req">*</span>
                  </div>
                  <textarea
                    rows={5}
                    value={state.linksRaw}
                    onChange={(e) => setState((s) => ({ ...s, linksRaw: e.target.value }))}
                    placeholder={"https://...\nhttps://..."}
                  />
                  <div className="hint">一行一個 URL，可多筆。</div>
                  {errors.linksRaw && <div className="error">{errors.linksRaw}</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">投放項目</div>
                <div className="card-desc">數量需符合最小單位倍數（暫定定價）。</div>
              </div>
              <button
                className="btn primary"
                type="button"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    items: [...s.items, { placement: "fb_like", target: "100" }],
                  }))
                }
              >
                新增一筆
              </button>
            </div>
            <div className="card-bd">
              <div className="list">
                {state.items.map((it, idx) => {
                  const rule = PRICING[it.placement];
                  const n = Number(it.target);
                  const amount = Number.isFinite(n) && n > 0 ? calcLineAmount(it.placement, n) : 0;
                  const itemErr = errors.items?.[idx];
                  return (
                    <div className="item" key={idx}>
                      <div className="item-hd">
                        <div className="item-title">第 {idx + 1} 筆</div>
                        <button
                          className="btn danger"
                          type="button"
                          disabled={state.items.length <= 1}
                          onClick={() =>
                            setState((s) => ({
                              ...s,
                              items: s.items.filter((_, i) => i !== idx),
                            }))
                          }
                        >
                          移除
                        </button>
                      </div>

                      <div className="row cols3">
                        <div className="field">
                          <div className="label">
                            平台/類型<span className="req">*</span>
                          </div>
                          <select
                            value={it.placement}
                            onChange={(e) =>
                              setState((s) => ({
                                ...s,
                                items: s.items.map((x, i) =>
                                  i === idx ? { ...x, placement: e.target.value as AdPlacement } : x,
                                ),
                              }))
                            }
                          >
                            {Object.entries(PRICING).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v.label}
                              </option>
                            ))}
                          </select>
                          {itemErr?.placement && <div className="error">{itemErr.placement}</div>}
                        </div>

                        <div className="field">
                          <div className="label">
                            目標數量<span className="req">*</span>
                          </div>
                          <input
                            value={it.target}
                            inputMode="numeric"
                            onChange={(e) =>
                              setState((s) => ({
                                ...s,
                                items: s.items.map((x, i) =>
                                  i === idx ? { ...x, target: e.target.value } : x,
                                ),
                              }))
                            }
                            placeholder={String(rule.minUnit)}
                          />
                          <div className="hint">最小單位：{rule.minUnit.toLocaleString()}</div>
                          {itemErr?.target && <div className="error">{itemErr.target}</div>}
                        </div>

                        <div className="field">
                          <div className="label">預估金額</div>
                          <input value={`NT$ ${amount.toLocaleString()}`} readOnly />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="sep" />

              <div className="kpi">
                <div className="hint">預估總價（暫定）</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>NT$ {computed.total.toLocaleString()}</div>
              </div>

              <div className="actions">
                <button className="btn primary" type="button" onClick={toConfirm}>
                  下一步：確認
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="grid">
          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">確認摘要</div>
                <div className="card-desc">此 demo 只確認流程，送出不會真的呼叫 API。</div>
              </div>
              <span className="tag">confirm</span>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">委刊單號</div>
                  <input value={state.orderNo} readOnly />
                </div>
                <div className="field">
                  <div className="label">案件名稱</div>
                  <input value={state.caseName} readOnly />
                </div>
                <div className="field">
                  <div className="label">種類</div>
                  <input value={state.kind === "new" ? "新案" : "加購"} readOnly />
                </div>
                <div className="field">
                  <div className="label">日期</div>
                  <input value={nowString()} readOnly />
                </div>
              </div>

              <div className="sep" />

              <div className="field">
                <div className="label">連結</div>
                <div className="list">
                  {links.map((u) => (
                    <div className="item" key={u}>
                      <div style={{ wordBreak: "break-all" }}>{u}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="sep" />

              <div className="field">
                <div className="label">投放項目</div>
                <div className="list">
                  {state.items.map((it, idx) => {
                    const rule = PRICING[it.placement];
                    const n = Number(it.target);
                    const amt = Number.isFinite(n) && n > 0 ? calcLineAmount(it.placement, n) : 0;
                    return (
                      <div className="item" key={idx}>
                        <div className="item-hd">
                          <div className="item-title">
                            {rule.label} / 數量 {Number.isFinite(n) ? n.toLocaleString() : "-"}
                          </div>
                          <div style={{ fontWeight: 800 }}>NT$ {amt.toLocaleString()}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="sep" />

              <div className="kpi">
                <div className="hint">預估總價（暫定）</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>NT$ {computed.total.toLocaleString()}</div>
              </div>

              <div className="actions">
                <button className="btn" type="button" onClick={() => setStep("edit")}>
                  返回修改
                </button>
                <button className="btn primary" type="button" onClick={onConfirmSubmit}>
                  確認送出
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === "submitted" && (
        <div className="grid">
          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">已送出（Demo）</div>
                  <div className="card-desc">這代表「表單 → 確認頁 → 送出」流程已可展示。</div>
              </div>
              <span className="tag">submitted</span>
            </div>
            <div className="card-bd">
              <div className="actions">
                <button className="btn" type="button" onClick={() => setStep("edit")}>
                  再次下單
                </button>
                <button className="btn primary" type="button" onClick={() => nav("/ad-performance")}>
                  前往成效頁
                </button>
              </div>
              <div className="sep" />
              <div className="hint">
                若你要接測試 API：後續可以在「確認送出」時改成呼叫後端或直接 fetch API，並把結果與錯誤顯示在成效頁。
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
