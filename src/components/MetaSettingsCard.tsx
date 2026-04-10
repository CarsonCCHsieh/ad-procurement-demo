import { useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { getMetaConfig, resetMetaConfig, saveMetaConfig, type MetaConfigV1 } from "../config/metaConfig";
import { verifyMetaApiKey } from "../lib/metaGraphApi";

type MsgKind = "success" | "info" | "warn" | "error";

export function MetaSettingsCard(props: {
  onNotice: (kind: MsgKind, text: string, ms?: number) => void;
}) {
  const { onNotice } = props;
  const [cfg, setCfg] = useState<MetaConfigV1>(() => getMetaConfig());
  const [show, setShow] = useState<Record<"ads" | "facebook" | "instagram", boolean>>({
    ads: false,
    facebook: false,
    instagram: false,
  });
  const [verifying, setVerifying] = useState<Record<"ads" | "facebook" | "instagram", boolean>>({
    ads: false,
    facebook: false,
    instagram: false,
  });

  const save = () => {
    saveMetaConfig({ ...cfg, mode: "live" });
    setCfg(getMetaConfig());
    onNotice("success", "Meta API 設定已儲存。", 2800);
  };

  const reset = () => {
    resetMetaConfig();
    setCfg(getMetaConfig());
    onNotice("info", "Meta API 設定已重設。", 2800);
  };

  const verify = async (scope: "ads" | "facebook" | "instagram") => {
    setVerifying((current) => ({ ...current, [scope]: true }));
    try {
      const result = await verifyMetaApiKey({ cfg, scope });
      if (result.ok) {
        onNotice("success", `${scope === "ads" ? "Meta Ads" : scope === "facebook" ? "Facebook" : "Instagram"} Key 驗證成功。`, 2400);
      } else {
        onNotice("error", `${scope === "ads" ? "Meta Ads" : scope === "facebook" ? "Facebook" : "Instagram"} Key 驗證失敗：${result.detail ?? "未知錯誤"}`, 4200);
      }
    } finally {
      setVerifying((current) => ({ ...current, [scope]: false }));
    }
  };

  const setToken = (scope: "ads" | "facebook" | "instagram", value: string) => {
    setCfg((current) => {
      if (scope === "ads") return { ...current, adsAccessToken: value };
      if (scope === "facebook") return { ...current, facebookAccessToken: value };
      return { ...current, instagramAccessToken: value };
    });
  };

  const isReady = !!cfg.adAccountId.trim() && (!!cfg.adsAccessToken.trim() || !!cfg.accessToken.trim());

  return (
    <CollapsibleCard
      accent="blue"
      title="Meta 基本設定"
      desc="管理 Graph API 版本、帳號與三組 API Key。前台會共用此處設定。"
      tag="Meta"
      storageKey="sec:meta-settings"
      defaultOpen={false}
    >
      <div className="hint" style={{ marginBottom: 12 }}>
        請在這裡維護 Meta Ads、Facebook、Instagram API Key，儲存後立即生效。
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
        <div className="label">Meta Ads API Key</div>
        <input
          type={show.ads ? "text" : "password"}
          value={cfg.adsAccessToken}
          onChange={(event) => setToken("ads", event.target.value.trim())}
          placeholder="請貼上 Meta Ads API Key"
        />
        <div className="actions inline" style={{ marginTop: 8 }}>
          <button className="btn sm" type="button" onClick={() => setShow((state) => ({ ...state, ads: !state.ads }))}>
            {show.ads ? "隱藏 Key" : "顯示 Key"}
          </button>
          <button className="btn sm" type="button" onClick={() => void verify("ads")} disabled={verifying.ads}>
            {verifying.ads ? "驗證中..." : "驗證"}
          </button>
        </div>
      </div>

      <div className="field">
        <div className="label">Facebook API Key</div>
        <input
          type={show.facebook ? "text" : "password"}
          value={cfg.facebookAccessToken}
          onChange={(event) => setToken("facebook", event.target.value.trim())}
          placeholder="請貼上 Facebook API Key"
        />
        <div className="actions inline" style={{ marginTop: 8 }}>
          <button className="btn sm" type="button" onClick={() => setShow((state) => ({ ...state, facebook: !state.facebook }))}>
            {show.facebook ? "隱藏 Key" : "顯示 Key"}
          </button>
          <button className="btn sm" type="button" onClick={() => void verify("facebook")} disabled={verifying.facebook}>
            {verifying.facebook ? "驗證中..." : "驗證"}
          </button>
        </div>
      </div>

      <div className="field">
        <div className="label">Instagram API Key</div>
        <input
          type={show.instagram ? "text" : "password"}
          value={cfg.instagramAccessToken}
          onChange={(event) => setToken("instagram", event.target.value.trim())}
          placeholder="請貼上 Instagram API Key"
        />
        <div className="actions inline" style={{ marginTop: 8 }}>
          <button className="btn sm" type="button" onClick={() => setShow((state) => ({ ...state, instagram: !state.instagram }))}>
            {show.instagram ? "隱藏 Key" : "顯示 Key"}
          </button>
          <button className="btn sm" type="button" onClick={() => void verify("instagram")} disabled={verifying.instagram}>
            {verifying.instagram ? "驗證中..." : "驗證"}
          </button>
        </div>
      </div>

      <div className="sep" />
      <div className="actions inline">
        <button className="btn" type="button" onClick={reset}>
          重設
        </button>
        <button className="btn primary" type="button" onClick={save}>
          儲存 Meta 設定
        </button>
        <span className="hint">{isReady ? "設定完整，可開始投放" : "至少需填 Meta Ads API Key 與廣告帳號 ID"}</span>
      </div>
    </CollapsibleCard>
  );
}

