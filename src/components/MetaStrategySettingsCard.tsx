import { useMemo, useState } from "react";
import {
  DEFAULT_META_OPTIMIZATION_CONFIG,
  getMetaPresetConfig,
  resetMetaPresetConfig,
  saveMetaPresetConfig,
  type MetaIndustryPreset,
  type MetaPresetConfigV1,
} from "../config/metaPresetConfig";
import { listMetaGoals } from "../lib/metaGoals";
import { CollapsibleCard } from "./CollapsibleCard";

export function MetaStrategySettingsCard(props: {
  onNotice: (tone: "success" | "error" | "info", text: string, timeout?: number) => void;
}) {
  const { onNotice } = props;
  const [cfg, setCfg] = useState<MetaPresetConfigV1>(() => getMetaPresetConfig());
  const goals = useMemo(() => listMetaGoals(), []);

  const save = () => {
    saveMetaPresetConfig(cfg);
    onNotice("success", "Meta 投放策略已儲存。", 2600);
  };

  const reset = () => {
    resetMetaPresetConfig();
    setCfg(getMetaPresetConfig());
    onNotice("info", "Meta 投放策略已重設為安全預設。", 2600);
  };

  const setIndustry = (index: number, patch: Partial<MetaIndustryPreset>) => {
    setCfg((current) => ({
      ...current,
      industries: current.industries.map((industry, i) => (i === index ? { ...industry, ...patch } : industry)),
    }));
  };

  const toggleGoal = (industry: MetaIndustryPreset, key: MetaIndustryPreset["recommendedGoals"][number]) => {
    return industry.recommendedGoals.includes(key)
      ? industry.recommendedGoals.filter((item) => item !== key)
      : [...industry.recommendedGoals, key];
  };

  return (
    <CollapsibleCard title="Meta 投放策略" desc="管理產業模板、A/B 優化門檻與預設版位。" tag="策略" storageKey="sec:meta-strategy">
      <div className="row cols4">
        <label className="field">
          <div className="label">每幾分鐘同步</div>
          <input
            inputMode="numeric"
            value={String(cfg.optimization.autoStopCheckMinutes)}
            onChange={(event) => setCfg({ ...cfg, optimization: { ...cfg.optimization, autoStopCheckMinutes: Number(event.target.value) || 5 } })}
          />
        </label>
        <label className="field">
          <div className="label">每輪最多案件</div>
          <input
            inputMode="numeric"
            value={String(cfg.optimization.maxRowsPerRun)}
            onChange={(event) => setCfg({ ...cfg, optimization: { ...cfg.optimization, maxRowsPerRun: Number(event.target.value) || 8 } })}
          />
        </label>
        <label className="field">
          <div className="label">判斷最低花費</div>
          <input
            inputMode="decimal"
            value={String(cfg.optimization.minSpendForAdvice)}
            onChange={(event) => setCfg({ ...cfg, optimization: { ...cfg.optimization, minSpendForAdvice: Number(event.target.value) || 0 } })}
          />
        </label>
        <label className="field">
          <div className="label">輸家停用比例</div>
          <input
            inputMode="decimal"
            value={String(cfg.optimization.losingRatioThreshold)}
            onChange={(event) => setCfg({ ...cfg, optimization: { ...cfg.optimization, losingRatioThreshold: Number(event.target.value) || 0.72 } })}
          />
        </label>
      </div>

      <div className="actions inline" style={{ marginTop: 12 }}>
        <button className="btn primary" type="button" onClick={save}>儲存策略</button>
        <button className="btn" type="button" onClick={() => setCfg({ ...cfg, optimization: { ...DEFAULT_META_OPTIMIZATION_CONFIG } })}>重設優化門檻</button>
        <button className="btn danger" type="button" onClick={reset}>重設全部模板</button>
      </div>

      <div className="sep" />

      <div className="dense-table">
        <div className="dense-th">產業</div>
        <div className="dense-th">狀態</div>
        <div className="dense-th">年齡</div>
        <div className="dense-th">興趣受眾</div>
        <div className="dense-th">建議目標</div>
        {cfg.industries.map((industry, index) => (
          <div className="dense-tr" key={industry.key}>
            <div className="dense-td dense-main">
              <div className="dense-title">{industry.label}</div>
              <div className="dense-meta">{industry.description}</div>
            </div>
            <div className="dense-td">
              <select value={industry.enabled ? "on" : "off"} onChange={(event) => setIndustry(index, { enabled: event.target.value === "on" })}>
                <option value="on">啟用</option>
                <option value="off">停用</option>
              </select>
            </div>
            <div className="dense-td">
              <div className="actions inline">
                <input style={{ width: 72 }} inputMode="numeric" value={String(industry.ageMin)} onChange={(event) => setIndustry(index, { ageMin: Number(event.target.value) || 18 })} />
                <input style={{ width: 72 }} inputMode="numeric" value={String(industry.ageMax)} onChange={(event) => setIndustry(index, { ageMax: Number(event.target.value) || 49 })} />
              </div>
            </div>
            <div className="dense-td dense-main">
              <textarea
                rows={3}
                value={industry.detailedTargetingText}
                onChange={(event) => setIndustry(index, { detailedTargetingText: event.target.value })}
                placeholder="格式：interest_id | 名稱，每行一個"
              />
            </div>
            <div className="dense-td dense-main">
              <div className="actions inline">
                {goals.map((goal) => (
                  <label className="tag" key={`${industry.key}-${goal.key}`}>
                    <input
                      type="checkbox"
                      checked={industry.recommendedGoals.includes(goal.key)}
                      onChange={() => setIndustry(index, { recommendedGoals: toggleGoal(industry, goal.key) })}
                    />
                    {goal.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}
