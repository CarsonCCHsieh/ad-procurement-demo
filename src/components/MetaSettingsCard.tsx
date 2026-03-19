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
    onNotice("success", `Meta \u8a2d\u5b9a\u5df2\u5132\u5b58\uff08${time}\uff09`, 3200);
  };

  const reset = () => {
    resetMetaConfig();
    setCfg(getMetaConfig());
    onNotice("info", "\u004d\u0065\u0074\u0061 \u8a2d\u5b9a\u5df2\u91cd\u8a2d\u70ba\u9810\u8a2d\u503c\u3002", 3200);
  };

  const isReady = !!cfg.accessToken && !!cfg.adAccountId;

  return (
    <CollapsibleCard
      accent="blue"
      title="\u004d\u0065\u0074\u0061 \u5b98\u65b9\u6295\u5ee3\u8a2d\u5b9a"
      desc="\u7ba1\u7406\u5ee3\u544a\u5e33\u865f\u3001\u7c89\u5c08\u8eab\u4efd\u8207\u6295\u653e\u6191\u8b49\u3002\u9019\u4e9b\u8cc7\u6599\u53ea\u4fdd\u5b58\u5728\u76ee\u524d\u700f\u89bd\u5668\u8207\u672c\u6a5f\u5f8c\u7aef\u3002"
      tag="\u004d\u0065\u0074\u0061"
      storageKey="sec:meta-settings"
      defaultOpen={false}
    >
      <div className="hint" style={{ marginBottom: 10 }}>
        \u6b0a\u6756\u5c6c\u65bc\u654f\u611f\u8cc7\u6599\uff0c\u8acb\u7531\u7ba1\u7406\u54e1\u4fdd\u7ba1\u8207\u66f4\u65b0\u3002
      </div>

      <div className="row">
        <div className="field">
          <div className="label">Graph API \u7248\u672c</div>
          <input
            value={cfg.apiVersion}
            onChange={(event) => setCfg((state) => ({ ...state, apiVersion: event.target.value.trim() }))}
            placeholder="v23.0"
          />
        </div>
      </div>

      <div className="row cols2">
        <div className="field">
          <div className="label">\u5ee3\u544a\u5e33\u865f ID</div>
          <input
            value={cfg.adAccountId}
            onChange={(event) => setCfg((state) => ({ ...state, adAccountId: event.target.value.trim() }))}
            placeholder="\u4f8b\u5982\uff1aact_1234567890"
          />
        </div>
        <div className="field">
          <div className="label">Facebook \u7c89\u5c08 ID</div>
          <input
            value={cfg.pageId}
            onChange={(event) => setCfg((state) => ({ ...state, pageId: event.target.value.trim() }))}
            placeholder="\u4f8b\u5982\uff1a1122334455"
          />
        </div>
      </div>

      <div className="row cols2">
        <div className="field">
          <div className="label">Instagram Actor ID</div>
          <input
            value={cfg.instagramActorId}
            onChange={(event) => setCfg((state) => ({ ...state, instagramActorId: event.target.value.trim() }))}
            placeholder="\u4f8b\u5982\uff1a9988776655"
          />
        </div>
        <div className="field">
          <div className="label">\u5e63\u5225\u8207\u6642\u5340</div>
          <div className="row cols2">
            <input value="TWD" readOnly />
            <input
              value={cfg.timezone}
              onChange={(event) => setCfg((state) => ({ ...state, timezone: event.target.value.trim() }))}
              placeholder="Asia/Taipei"
            />
          </div>
          <div className="hint">\u76ee\u524d\u56fa\u5b9a\u4f7f\u7528\u53f0\u5e63\u8207\u53f0\u5317\u6642\u5340\u3002</div>
        </div>
      </div>

      <div className="field">
        <div className="label">Access Token</div>
        <input
          type={showToken ? "text" : "password"}
          value={cfg.accessToken}
          onChange={(event) => setCfg((state) => ({ ...state, accessToken: event.target.value.trim() }))}
          placeholder="\u8acb\u8cbc\u4e0a Meta system user token"
        />
        <div className="actions inline">
          <button className="btn sm" type="button" onClick={() => setShowToken((value) => !value)}>
            {showToken ? "\u96b1\u85cf Token" : "\u986f\u793a Token"}
          </button>
          <span className="hint">
            {isReady ? "\u57fa\u672c\u6295\u653e\u8a2d\u5b9a\u5df2\u5b8c\u6210" : "\u81f3\u5c11\u8981\u586b\u5ee3\u544a\u5e33\u865f ID \u8207 Token"}
          </span>
        </div>
      </div>

      <div className="sep" />
      <div className="actions inline">
        <button className="btn" type="button" onClick={reset}>
          \u91cd\u8a2d Meta \u8a2d\u5b9a
        </button>
        <button className="btn primary" type="button" onClick={save}>
          \u5132\u5b58 Meta \u8a2d\u5b9a
        </button>
      </div>
    </CollapsibleCard>
  );
}
