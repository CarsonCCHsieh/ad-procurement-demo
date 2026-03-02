import { useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { getMetaConfig, resetMetaConfig, saveMetaConfig, type MetaConfigV1 } from "../config/metaConfig";

type MsgKind = "success" | "info" | "warn" | "error";

export function MetaSettingsCard(props: {
  onNotice: (kind: MsgKind, text: string, ms?: number) => void;
}) {
  const { onNotice } = props;
  const [cfg, setCfg] = useState<MetaConfigV1>(() => getMetaConfig());
  const [showToken, setShowToken] = useState(false);

  const save = () => {
    saveMetaConfig(cfg);
    setCfg(getMetaConfig());
    const t = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    onNotice("success", `Meta 設定已儲存（${t}）。`, 3200);
  };

  const reset = () => {
    resetMetaConfig();
    setCfg(getMetaConfig());
    onNotice("info", "Meta 設定已重設為預設值。", 3200);
  };

  const isLiveReady = cfg.mode === "live" && !!cfg.accessToken && !!cfg.adAccountId;

  return (
    <CollapsibleCard
      accent="blue"
      title="Meta 官方投放設定"
      desc="先用模擬模式驗證流程；要正式下單時，再切為正式模式並填入 Access Token 與廣告帳號。"
      tag="Meta"
      storageKey="sec:meta-settings"
      defaultOpen={false}
    >
      <div className="row cols2">
        <div className="field">
          <div className="label">執行模式</div>
          <select value={cfg.mode} onChange={(e) => setCfg((s) => ({ ...s, mode: e.target.value as "simulate" | "live" }))}>
            <option value="simulate">模擬模式（不送 Meta）</option>
            <option value="live">正式模式（送 Meta API）</option>
          </select>
        </div>
        <div className="field">
          <div className="label">Graph API 版本</div>
          <input value={cfg.apiVersion} onChange={(e) => setCfg((s) => ({ ...s, apiVersion: e.target.value.trim() }))} placeholder="v23.0" />
        </div>
      </div>

      <div className="row cols2">
        <div className="field">
          <div className="label">廣告帳號 ID（不含 act_）</div>
          <input value={cfg.adAccountId} onChange={(e) => setCfg((s) => ({ ...s, adAccountId: e.target.value.trim() }))} placeholder="例如 1234567890" />
        </div>
        <div className="field">
          <div className="label">粉專 Page ID</div>
          <input value={cfg.pageId} onChange={(e) => setCfg((s) => ({ ...s, pageId: e.target.value.trim() }))} placeholder="例如 1122334455" />
        </div>
      </div>

      <div className="row cols2">
        <div className="field">
          <div className="label">Instagram Actor ID</div>
          <input value={cfg.instagramActorId} onChange={(e) => setCfg((s) => ({ ...s, instagramActorId: e.target.value.trim() }))} placeholder="例如 9988776655" />
        </div>
        <div className="field">
          <div className="label">幣別 / 時區</div>
          <div className="row cols2">
            <input value={cfg.currency} onChange={(e) => setCfg((s) => ({ ...s, currency: e.target.value.toUpperCase() }))} placeholder="TWD" />
            <input value={cfg.timezone} onChange={(e) => setCfg((s) => ({ ...s, timezone: e.target.value }))} placeholder="Asia/Taipei" />
          </div>
        </div>
      </div>

      <div className="field">
        <div className="label">Access Token</div>
        <input
          type={showToken ? "text" : "password"}
          value={cfg.accessToken}
          onChange={(e) => setCfg((s) => ({ ...s, accessToken: e.target.value.trim() }))}
          placeholder="貼上 Meta System User / Long-lived token"
        />
        <div className="actions inline">
          <button className="btn sm" type="button" onClick={() => setShowToken((x) => !x)}>
            {showToken ? "隱藏 Token" : "顯示 Token"}
          </button>
          <span className="hint">{isLiveReady ? "正式模式設定完整，可送 API。" : "目前仍建議先用模擬模式驗證流程。"}</span>
        </div>
      </div>

      <div className="sep" />
      <div className="actions inline">
        <button className="btn" type="button" onClick={reset}>
          重設 Meta 設定
        </button>
        <button className="btn primary" type="button" onClick={save}>
          儲存 Meta 設定
        </button>
      </div>
    </CollapsibleCard>
  );
}

