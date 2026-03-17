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
    const time = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    onNotice("success", `Meta 設定已儲存（${time}）`, 3200);
  };

  const reset = () => {
    resetMetaConfig();
    setCfg(getMetaConfig());
    onNotice("info", "Meta 設定已重設為預設值。", 3200);
  };

  const isReady = !!cfg.accessToken && !!cfg.adAccountId;

  return (
    <CollapsibleCard
      accent="blue"
      title="Meta 官方投廣設定"
      desc="管理廣告帳號、粉專與權杖。這些資料只保存在目前瀏覽器與本機後端。"
      tag="Meta"
      storageKey="sec:meta-settings"
      defaultOpen={false}
    >
      <div className="hint" style={{ marginBottom: 10 }}>
        權杖屬於敏感資料，請由管理員保管與更新。
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
          <div className="label">廣告帳號 ID</div>
          <input
            value={cfg.adAccountId}
            onChange={(event) => setCfg((state) => ({ ...state, adAccountId: event.target.value.trim() }))}
            placeholder="例如：act_1234567890"
          />
        </div>
        <div className="field">
          <div className="label">Facebook 粉專 ID</div>
          <input
            value={cfg.pageId}
            onChange={(event) => setCfg((state) => ({ ...state, pageId: event.target.value.trim() }))}
            placeholder="例如：1122334455"
          />
        </div>
      </div>

      <div className="row cols2">
        <div className="field">
          <div className="label">Instagram Actor ID</div>
          <input
            value={cfg.instagramActorId}
            onChange={(event) => setCfg((state) => ({ ...state, instagramActorId: event.target.value.trim() }))}
            placeholder="例如：9988776655"
          />
        </div>
        <div className="field">
          <div className="label">幣別與時區</div>
          <div className="row cols2">
            <input value="TWD" readOnly />
            <input
              value={cfg.timezone}
              onChange={(event) => setCfg((state) => ({ ...state, timezone: event.target.value.trim() }))}
              placeholder="Asia/Taipei"
            />
          </div>
          <div className="hint">目前固定使用台幣與台北時區。</div>
        </div>
      </div>

      <div className="field">
        <div className="label">Access Token</div>
        <input
          type={showToken ? "text" : "password"}
          value={cfg.accessToken}
          onChange={(event) => setCfg((state) => ({ ...state, accessToken: event.target.value.trim() }))}
          placeholder="請貼上 Meta system user token"
        />
        <div className="actions inline">
          <button className="btn sm" type="button" onClick={() => setShowToken((value) => !value)}>
            {showToken ? "隱藏 Token" : "顯示 Token"}
          </button>
          <span className="hint">{isReady ? "基本投放設定已完成" : "至少要填廣告帳號 ID 與 Token"}</span>
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
