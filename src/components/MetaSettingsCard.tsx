import { useEffect, useState } from "react";
import { fetchMetaConfigFromServer, saveMetaConfigToServer, type MetaConfigV1 } from "../config/metaConfig";
import { apiUrl } from "../lib/apiBase";
import { CollapsibleCard } from "./CollapsibleCard";

type TokenScope = "ads" | "facebook" | "instagram";

export function MetaSettingsCard(props: {
  onNotice: (tone: "success" | "error" | "info", text: string, timeout?: number) => void;
}) {
  const { onNotice } = props;
  const [cfg, setCfg] = useState<MetaConfigV1 | null>(null);
  const [tokens, setTokens] = useState<Record<TokenScope, string>>({ ads: "", facebook: "", instagram: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState<Record<TokenScope, boolean>>({ ads: false, facebook: false, instagram: false });

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
        adsAccessToken: tokens.ads,
        facebookAccessToken: tokens.facebook,
        instagramAccessToken: tokens.instagram,
      });
      setCfg(next);
      setTokens({ ads: "", facebook: "", instagram: "" });
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
      onNotice("error", "請先輸入要驗證的 API Key。", 2600);
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
      const label = scope === "ads" ? "Meta Ads" : scope === "facebook" ? "Facebook" : "Instagram";
      onNotice("success", `${label} API Key 驗證成功。`, 2600);
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
    <CollapsibleCard title="Meta 基本設定" desc="API Key 只會儲存在本機後端，不會寫入前端或 GitHub。" tag="Meta" storageKey="sec:meta-settings">
      <div className="row cols2">
        <label className="field">
          <div className="label">Graph API 版本</div>
          <input value={cfg.apiVersion} onChange={(event) => setCfg({ ...cfg, apiVersion: event.target.value.trim() || "v20.0" })} />
        </label>
        <label className="field">
          <div className="label">預設廣告帳號 ID</div>
          <input value={cfg.adAccountId} onChange={(event) => setCfg({ ...cfg, adAccountId: event.target.value.replace(/^act_/i, "") })} placeholder="例如：1234567890" />
        </label>
        <label className="field">
          <div className="label">Facebook 粉絲專頁 ID</div>
          <input value={cfg.pageId} onChange={(event) => setCfg({ ...cfg, pageId: event.target.value.trim() })} />
        </label>
        <label className="field">
          <div className="label">Facebook 粉絲專頁名稱</div>
          <input value={cfg.pageName} onChange={(event) => setCfg({ ...cfg, pageName: event.target.value.trim() })} />
        </label>
        <label className="field">
          <div className="label">Instagram Actor ID</div>
          <input value={cfg.instagramActorId} onChange={(event) => setCfg({ ...cfg, instagramActorId: event.target.value.trim() })} />
        </label>
      </div>

      <div className="sep" />

      {(["ads", "facebook", "instagram"] as TokenScope[]).map((scope) => (
        <div className="row cols2" key={scope} style={{ marginBottom: 10 }}>
          <label className="field">
            <div className="label">{scope === "ads" ? "Meta Ads API Key" : scope === "facebook" ? "Facebook API Key" : "Instagram API Key"}</div>
            <input
              type="password"
              value={tokens[scope]}
              onChange={(event) => setTokens((state) => ({ ...state, [scope]: event.target.value.trim() }))}
              placeholder="貼上新 Key 後可驗證並儲存"
            />
          </label>
          <div className="field">
            <div className="label">狀態</div>
            <div className="actions inline">
              <span className="tag">{cfg.tokenStatus?.[scope] ? "已設定" : "未設定"}</span>
              <button className="btn" type="button" onClick={() => void verify(scope)} disabled={verifying[scope]}>
                {verifying[scope] ? "驗證中..." : "驗證"}
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="actions inline">
        <button className="btn primary" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "儲存中..." : "儲存 Meta 設定"}
        </button>
      </div>
    </CollapsibleCard>
  );
}
