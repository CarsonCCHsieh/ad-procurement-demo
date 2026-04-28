import { useEffect, useState } from "react";
import { fetchMetaConfigFromServer, saveMetaConfigToServer, type MetaConfigV1 } from "../config/metaConfig";
import { apiUrl } from "../lib/apiBase";
import { CollapsibleCard } from "./CollapsibleCard";

type TokenScope = "user" | "ads" | "facebook" | "instagram";

const TOKEN_SCOPES: Array<{ scope: TokenScope; label: string; desc: string }> = [
  { scope: "user", label: "Meta User Key", desc: "共用 Key。若下方服務沒有另外設定，Meta Ads、Facebook、Instagram 都會使用這把 Key。" },
  { scope: "ads", label: "Meta Ads Key", desc: "選填。填入後只覆蓋廣告帳號、建立廣告與 insights 相關功能。" },
  { scope: "facebook", label: "Facebook Page Key", desc: "選填。填入後只覆蓋 Facebook 粉專、貼文解析與貼文成效讀取。" },
  { scope: "instagram", label: "Instagram Key", desc: "選填。填入後只覆蓋 Instagram media / insights 相關功能。" },
];

function sourceText(cfg: MetaConfigV1, scope: Exclude<TokenScope, "user">) {
  const source = cfg.tokenSource?.[scope];
  if (source === "specific") return "使用專用 Key";
  if (source === "user") return "使用 User Key";
  return "未設定";
}

export function MetaSettingsCard(props: {
  onNotice: (tone: "success" | "error" | "info", text: string, timeout?: number) => void;
}) {
  const { onNotice } = props;
  const [cfg, setCfg] = useState<MetaConfigV1 | null>(null);
  const [tokens, setTokens] = useState<Record<TokenScope, string>>({ user: "", ads: "", facebook: "", instagram: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState<Record<TokenScope, boolean>>({ user: false, ads: false, facebook: false, instagram: false });

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    fetchMetaConfigFromServer()
      .then((next) => {
        if (!canceled) setCfg(next);
      })
      .catch((error) => {
        if (!canceled) onNotice("error", `Meta 設定讀取失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [onNotice]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const next = await saveMetaConfigToServer({
        ...cfg,
        userAccessToken: tokens.user,
        adsAccessToken: tokens.ads,
        facebookAccessToken: tokens.facebook,
        instagramAccessToken: tokens.instagram,
      });
      setCfg(next);
      setTokens({ user: "", ads: "", facebook: "", instagram: "" });
      onNotice("success", "Meta 設定已儲存。", 2600);
    } catch (error) {
      onNotice("error", `Meta 設定儲存失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
    } finally {
      setSaving(false);
    }
  };

  const verify = async (scope: TokenScope) => {
    const token = tokens[scope].trim();
    if (!token) {
      onNotice("error", "請先貼上要驗證的 API Key。", 2600);
      return;
    }
    setVerifying((state) => ({ ...state, [scope]: true }));
    try {
      const response = await fetch(apiUrl("/api/meta/verify-token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, token, apiVersion: cfg?.apiVersion || "v20.0" }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const label = TOKEN_SCOPES.find((item) => item.scope === scope)?.label ?? "Meta API Key";
      onNotice("success", `${label} 驗證成功。`, 2600);
    } catch (error) {
      onNotice("error", `驗證失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
    } finally {
      setVerifying((state) => ({ ...state, [scope]: false }));
    }
  };

  if (loading || !cfg) {
    return (
      <CollapsibleCard title="Meta 基本設定" desc="讀取中" tag="Meta" storageKey="sec:meta-settings">
        <div className="hint">正在讀取後端設定...</div>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard title="Meta 基本設定" desc="API Key 只儲存在本機後端，不會寫入前端或 GitHub。User Key 可作為通用 Key；服務專用 Key 可覆蓋 User Key。" tag="Meta" storageKey="sec:meta-settings">
      <div className="row cols2">
        <label className="field">
          <div className="label">Graph API 版本</div>
          <input value={cfg.apiVersion} onChange={(event) => setCfg({ ...cfg, apiVersion: event.target.value.trim() || "v20.0" })} />
        </label>
        <label className="field">
          <div className="label">預設廣告帳號 ID</div>
          <input value={cfg.adAccountId} onChange={(event) => setCfg({ ...cfg, adAccountId: event.target.value.replace(/^act_/i, "") })} placeholder="例如：234567890" />
        </label>
        <label className="field">
          <div className="label">Facebook 粉專 ID</div>
          <input value={cfg.pageId} onChange={(event) => setCfg({ ...cfg, pageId: event.target.value.trim() })} />
        </label>
        <label className="field">
          <div className="label">Facebook 粉專名稱</div>
          <input value={cfg.pageName} onChange={(event) => setCfg({ ...cfg, pageName: event.target.value.trim() })} />
        </label>
        <label className="field">
          <div className="label">Instagram Actor ID</div>
          <input value={cfg.instagramActorId} onChange={(event) => setCfg({ ...cfg, instagramActorId: event.target.value.trim() })} />
        </label>
      </div>

      <div className="sep" />

      <div className="stack gap-sm">
        {TOKEN_SCOPES.map(({ scope, label, desc }) => (
          <div className="token-setting-row" key={scope}>
            <label className="field token-field">
              <div className="label">{label}</div>
              <input
                type="password"
                value={tokens[scope]}
                onChange={(event) => setTokens((state) => ({ ...state, [scope]: event.target.value.trim() }))}
                placeholder="貼上新的 Key 後可驗證並儲存"
              />
              <div className="hint">{desc}</div>
            </label>
            <div className="field token-status-field">
              <div className="label">狀態</div>
              <div className="actions inline">
                <span className="tag">{cfg.tokenStatus?.[scope] ? "已設定" : "未設定"}</span>
                {scope !== "user" && <span className="tag subtle">{sourceText(cfg, scope)}</span>}
                <button className="btn" type="button" onClick={() => void verify(scope)} disabled={verifying[scope]}>
                  {verifying[scope] ? "驗證中..." : "驗證"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="actions inline">
        <button className="btn primary" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "儲存中..." : "儲存 Meta 設定"}
        </button>
      </div>
    </CollapsibleCard>
  );
}
