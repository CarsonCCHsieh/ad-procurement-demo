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
    saveMetaConfig({ ...cfg, mode: "live" });
    setCfg(getMetaConfig());
    onNotice("success", "Meta 基本設定已儲存。", 2800);
  };

  const reset = () => {
    resetMetaConfig();
    setCfg(getMetaConfig());
    onNotice("info", "Meta 基本設定已重設。", 2800);
  };

  const isReady = !!cfg.accessToken.trim() && !!cfg.adAccountId.trim();

  return (
    <CollapsibleCard
      accent="blue"
      title="Meta 基本設定"
      desc="管理 Graph API 版本、Access Token 與預設投放帳號。這裡只放必要憑證，不放投放策略。"
      tag="Meta"
      storageKey="sec:meta-settings"
      defaultOpen={false}
    >
      <div className="hint" style={{ marginBottom: 12 }}>
        Access Token 屬於敏感資料，請只由管理員維護。
      </div>

      <div className="row">
        <div className="field">
          <div className="label">Graph API 版本</div>
          <input
            value={cfg.apiVersion}
            onChange={(event) => setCfg((state) => ({ ...state, apiVersion: event.target.value.trim() }))}
            placeholder="v23.0"
          />
        </div>
      </div>

      <div className="row cols2">
        <div className="field">
          <div className="label">預設廣告帳號 ID</div>
          <input
            value={cfg.adAccountId}
            onChange={(event) =>
              setCfg((state) => ({ ...state, adAccountId: event.target.value.trim().replace(/^act_/i, "") }))
            }
            placeholder="例如 1234567890"
          />
          <div className="hint">只填數字，不需要加上 `act_`。</div>
        </div>
        <div className="field">
          <div className="label">Facebook 粉專 ID</div>
          <input
            value={cfg.pageId}
            onChange={(event) => setCfg((state) => ({ ...state, pageId: event.target.value.trim() }))}
            placeholder="例如 112233445566"
          />
        </div>
      </div>

      <div className="row cols2">
        <div className="field">
          <div className="label">Instagram Actor ID</div>
          <input
            value={cfg.instagramActorId}
            onChange={(event) => setCfg((state) => ({ ...state, instagramActorId: event.target.value.trim() }))}
            placeholder="例如 9988776655"
          />
        </div>
        <div className="field">
          <div className="label">時區</div>
          <div className="row cols2">
            <input value="TWD" readOnly />
            <input
              value={cfg.timezone}
              onChange={(event) => setCfg((state) => ({ ...state, timezone: event.target.value.trim() }))}
              placeholder="Asia/Taipei"
            />
          </div>
        </div>
      </div>

      <div className="field">
        <div className="label">Access Token</div>
        <input
          type={showToken ? "text" : "password"}
          value={cfg.accessToken}
          onChange={(event) => setCfg((state) => ({ ...state, accessToken: event.target.value.trim() }))}
          placeholder="請貼上 Meta System User Access Token"
        />
        <div className="actions inline" style={{ marginTop: 8 }}>
          <button className="btn sm" type="button" onClick={() => setShowToken((value) => !value)}>
            {showToken ? "隱藏 Token" : "顯示 Token"}
          </button>
          <span className="hint">{isReady ? "已具備基本連線條件" : "至少需填入 Access Token 與廣告帳號 ID"}</span>
        </div>
      </div>

      <div className="sep" />
      <div className="actions inline">
        <button className="btn" type="button" onClick={reset}>
          重設
        </button>
        <button className="btn primary" type="button" onClick={save}>
          儲存 Meta 基本設定
        </button>
      </div>
    </CollapsibleCard>
  );
}