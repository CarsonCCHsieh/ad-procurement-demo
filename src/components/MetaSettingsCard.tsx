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
    // Meta orders are always live mode now.
    saveMetaConfig({ ...cfg, mode: "live" });
    setCfg(getMetaConfig());
    const t = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    onNotice("success", `Meta settings saved (${t})`, 3200);
  };

  const reset = () => {
    resetMetaConfig();
    setCfg(getMetaConfig());
    onNotice("info", "Meta settings reset to default", 3200);
  };

  const isReady = !!cfg.accessToken && !!cfg.adAccountId;

  return (
    <CollapsibleCard
      accent="blue"
      title="Meta Official Ads Settings"
      desc="Configure Meta account and access credentials for live campaign creation."
      tag="Meta"
      storageKey="sec:meta-settings"
      defaultOpen={false}
    >
      <div className="row">
        <div className="field">
          <div className="label">Graph API Version</div>
          <input
            value={cfg.apiVersion}
            onChange={(e) => setCfg((s) => ({ ...s, apiVersion: e.target.value.trim() }))}
            placeholder="v23.0"
          />
        </div>
      </div>

      <div className="row cols2">
        <div className="field">
          <div className="label">Ad Account ID</div>
          <input
            value={cfg.adAccountId}
            onChange={(e) => setCfg((s) => ({ ...s, adAccountId: e.target.value.trim() }))}
            placeholder="e.g. 1234567890"
          />
        </div>
        <div className="field">
          <div className="label">Facebook Page ID</div>
          <input
            value={cfg.pageId}
            onChange={(e) => setCfg((s) => ({ ...s, pageId: e.target.value.trim() }))}
            placeholder="e.g. 1122334455"
          />
        </div>
      </div>

      <div className="row cols2">
        <div className="field">
          <div className="label">Instagram Actor ID</div>
          <input
            value={cfg.instagramActorId}
            onChange={(e) => setCfg((s) => ({ ...s, instagramActorId: e.target.value.trim() }))}
            placeholder="e.g. 9988776655"
          />
        </div>
        <div className="field">
          <div className="label">Currency / Timezone</div>
          <div className="row cols2">
            <input value="TWD" readOnly />
            <input
              value={cfg.timezone}
              onChange={(e) => setCfg((s) => ({ ...s, timezone: e.target.value }))}
              placeholder="Asia/Taipei"
            />
          </div>
          <div className="hint">Currency is fixed to TWD. Budget type is daily budget.</div>
        </div>
      </div>

      <div className="field">
        <div className="label">Access Token</div>
        <input
          type={showToken ? "text" : "password"}
          value={cfg.accessToken}
          onChange={(e) => setCfg((s) => ({ ...s, accessToken: e.target.value.trim() }))}
          placeholder="Paste Meta system user token"
        />
        <div className="actions inline">
          <button className="btn sm" type="button" onClick={() => setShowToken((x) => !x)}>
            {showToken ? "Hide Token" : "Show Token"}
          </button>
          <span className="hint">{isReady ? "Ready" : "Please fill Ad Account ID and Token"}</span>
        </div>
      </div>

      <div className="sep" />
      <div className="actions inline">
        <button className="btn" type="button" onClick={reset}>
          Reset Meta Settings
        </button>
        <button className="btn primary" type="button" onClick={save}>
          Save Meta Settings
        </button>
      </div>
    </CollapsibleCard>
  );
}
