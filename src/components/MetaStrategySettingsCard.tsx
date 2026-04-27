import { useMemo, useState } from "react";
import {
  DEFAULT_META_OPTIMIZATION_CONFIG,
  getMetaPresetConfig,
  resetMetaPresetConfig,
  saveMetaPresetConfig,
  type MetaIndustryPreset,
  type MetaPresetConfigV1,
  type MetaPresetGender,
} from "../config/metaPresetConfig";
import { listMetaGoals } from "../lib/metaGoals";
import { CollapsibleCard } from "./CollapsibleCard";

const FB_POSITION_OPTIONS = [
  { value: "feed", label: "Facebook 動態消息" },
  { value: "profile_feed", label: "Facebook 個人檔案動態消息" },
  { value: "story", label: "Facebook 限時動態" },
  { value: "facebook_reels", label: "Facebook Reels" },
  { value: "video_feeds", label: "Facebook 影片動態消息" },
  { value: "search", label: "Facebook 搜尋結果" },
];

const IG_POSITION_OPTIONS = [
  { value: "stream", label: "Instagram 動態消息" },
  { value: "story", label: "Instagram 限時動態" },
  { value: "reels", label: "Instagram Reels" },
  { value: "explore", label: "Instagram 探索" },
  { value: "profile_feed", label: "Instagram 個人檔案動態消息" },
];

function toggleList(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

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
    onNotice("info", "Meta 投放策略已重設為預設模板。", 2600);
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

  const setOptimization = (patch: Partial<MetaPresetConfigV1["optimization"]>) => {
    setCfg((current) => ({
      ...current,
      optimization: { ...current.optimization, ...patch },
    }));
  };

  return (
    <CollapsibleCard
      title="Meta 投放策略"
      desc="管理產業模板、A/B 優化門檻、預設受眾與版位。一般使用者會依這裡的模板下單。"
      tag="策略"
      storageKey="sec:meta-strategy"
      accent="blue"
    >
      <div className="meta-strategy-grid">
        <section className="meta-strategy-card">
          <div className="card-hd">
            <div>
              <div className="card-title">優化參數</div>
              <div className="card-desc">控制同步頻率、每輪處理上限與自動暫停低效組的門檻。</div>
            </div>
          </div>
          <div className="card-bd">
            <div className="meta-strategy-form">
              <label className="field">
                <div className="label">同步間隔（分鐘）</div>
                <input
                  inputMode="numeric"
                  value={String(cfg.optimization.autoStopCheckMinutes)}
                  onChange={(event) => setOptimization({ autoStopCheckMinutes: Number(event.target.value) || 5 })}
                />
              </label>
              <label className="field">
                <div className="label">每輪最多案件</div>
                <input
                  inputMode="numeric"
                  value={String(cfg.optimization.maxRowsPerRun)}
                  onChange={(event) => setOptimization({ maxRowsPerRun: Number(event.target.value) || 8 })}
                />
              </label>
              <label className="field">
                <div className="label">最低判斷花費</div>
                <input
                  inputMode="decimal"
                  value={String(cfg.optimization.minSpendForAdvice)}
                  onChange={(event) => setOptimization({ minSpendForAdvice: Number(event.target.value) || 0 })}
                />
              </label>
              <label className="field">
                <div className="label">低效停用比例</div>
                <input
                  inputMode="decimal"
                  value={String(cfg.optimization.losingRatioThreshold)}
                  onChange={(event) => setOptimization({ losingRatioThreshold: Number(event.target.value) || 0.72 })}
                />
                <div className="hint">例如 0.72 代表低於勝出組 72% 時可暫停。</div>
              </label>
            </div>
            <div className="actions inline meta-strategy-actions">
              <button className="btn primary" type="button" onClick={save}>儲存策略</button>
              <button className="btn" type="button" onClick={() => setCfg({ ...cfg, optimization: { ...DEFAULT_META_OPTIMIZATION_CONFIG } })}>重設優化門檻</button>
              <button className="btn danger" type="button" onClick={reset}>重設全部模板</button>
            </div>
          </div>
        </section>

        <section className="meta-strategy-card">
          <div className="card-hd">
            <div>
              <div className="card-title">產業模板</div>
              <div className="card-desc">每個產業可獨立收合設定。使用者選產業後，會自動套用這裡的受眾、年齡、版位與建議目標。</div>
            </div>
            <span className="tag">{cfg.industries.length} 個產業</span>
          </div>
          <div className="card-bd meta-strategy-industries">
            {cfg.industries.map((industry, index) => (
              <details className="meta-strategy-item" key={industry.key}>
                <summary>
                  <div className="meta-strategy-summary-main">
                    <strong>{industry.label}</strong>
                    <span>{industry.description}</span>
                  </div>
                  <div className="meta-strategy-summary-badges">
                    <span className={`meta-status ${industry.enabled ? "is-on" : "is-off"}`}>{industry.enabled ? "啟用" : "停用"}</span>
                    <span className="meta-chip">{industry.ageMin}-{industry.ageMax} 歲</span>
                    <span className="meta-chip">{industry.recommendedGoals.length} 個建議目標</span>
                  </div>
                </summary>

                <div className="meta-strategy-item-body">
                  <div className="meta-strategy-section">
                    <div className="meta-strategy-section-title">基本設定</div>
                    <div className="meta-strategy-form">
                      <label className="field">
                        <div className="label">狀態</div>
                        <select value={industry.enabled ? "on" : "off"} onChange={(event) => setIndustry(index, { enabled: event.target.value === "on" })}>
                          <option value="on">啟用</option>
                          <option value="off">停用</option>
                        </select>
                      </label>
                      <label className="field">
                        <div className="label">產業名稱</div>
                        <input value={industry.label} onChange={(event) => setIndustry(index, { label: event.target.value })} />
                      </label>
                      <label className="field">
                        <div className="label">預設日預算</div>
                        <input inputMode="numeric" value={String(industry.dailyBudget)} onChange={(event) => setIndustry(index, { dailyBudget: Number(event.target.value) || 1000 })} />
                      </label>
                      <label className="field">
                        <div className="label">CTA</div>
                        <input value={industry.ctaType} onChange={(event) => setIndustry(index, { ctaType: event.target.value })} />
                      </label>
                    </div>
                    <label className="field">
                      <div className="label">模板說明</div>
                      <input value={industry.description} onChange={(event) => setIndustry(index, { description: event.target.value })} />
                    </label>
                  </div>

                  <div className="meta-strategy-section">
                    <div className="meta-strategy-section-title">TA 範圍</div>
                    <div className="meta-strategy-form">
                      <label className="field">
                        <div className="label">地區代碼</div>
                        <input value={industry.countriesCsv} onChange={(event) => setIndustry(index, { countriesCsv: event.target.value })} />
                        <div className="hint">例如 TW；多國可用逗號分隔。</div>
                      </label>
                      <label className="field">
                        <div className="label">最低年齡</div>
                        <input inputMode="numeric" value={String(industry.ageMin)} onChange={(event) => setIndustry(index, { ageMin: Number(event.target.value) || 18 })} />
                      </label>
                      <label className="field">
                        <div className="label">最高年齡</div>
                        <input inputMode="numeric" value={String(industry.ageMax)} onChange={(event) => setIndustry(index, { ageMax: Number(event.target.value) || 49 })} />
                      </label>
                      <label className="field">
                        <div className="label">性別</div>
                        <select value={industry.gender} onChange={(event) => setIndustry(index, { gender: event.target.value as MetaPresetGender })}>
                          <option value="all">不限</option>
                          <option value="male">男性</option>
                          <option value="female">女性</option>
                        </select>
                      </label>
                    </div>
                    <div className="meta-strategy-two">
                      <label className="field">
                        <div className="label">AI 受眾補充說明</div>
                        <textarea
                          rows={4}
                          value={industry.audienceNote}
                          onChange={(event) => setIndustry(index, { audienceNote: event.target.value })}
                          placeholder="例如：偏潮流、街頭文化、球鞋收藏者。"
                        />
                      </label>
                      <label className="field">
                        <div className="label">興趣受眾模板</div>
                        <textarea
                          rows={4}
                          value={industry.detailedTargetingText}
                          onChange={(event) => setIndustry(index, { detailedTargetingText: event.target.value })}
                          placeholder="可填 # 關鍵字作為 AI 補充方向；若已知 Meta interest，可填 interest ID | 名稱。"
                        />
                      </label>
                      <label className="field">
                        <div className="label">儲備受眾</div>
                        <textarea
                          rows={3}
                          value={industry.customAudienceIdsText}
                          onChange={(event) => setIndustry(index, { customAudienceIdsText: event.target.value })}
                          placeholder="管理員可填 audience ID，一行一個。"
                        />
                      </label>
                      <label className="field">
                        <div className="label">排除受眾</div>
                        <textarea
                          rows={3}
                          value={industry.excludedAudienceIdsText}
                          onChange={(event) => setIndustry(index, { excludedAudienceIdsText: event.target.value })}
                          placeholder="管理員可填要排除的 audience ID，一行一個。"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="meta-strategy-section">
                    <div className="meta-strategy-section-title">建議目標</div>
                    <div className="meta-goal-grid">
                      {goals.map((goal) => (
                        <label className={`meta-goal-option ${industry.recommendedGoals.includes(goal.key) ? "is-selected" : ""}`} key={`${industry.key}-${goal.key}`}>
                          <input
                            type="checkbox"
                            checked={industry.recommendedGoals.includes(goal.key)}
                            onChange={() => setIndustry(index, { recommendedGoals: toggleGoal(industry, goal.key) })}
                          />
                          <span>{goal.label}</span>
                          <small>{goal.platform === "facebook" ? "Facebook" : "Instagram"} / {goal.recommendedPlacement}</small>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="meta-strategy-section">
                    <div className="meta-strategy-section-title">預設版位</div>
                    <div className="meta-strategy-two">
                      <div className="meta-placement-set">
                        <div className="placement-title">Facebook</div>
                        {FB_POSITION_OPTIONS.map((position) => (
                          <label className="check-row" key={`${industry.key}-fb-${position.value}`}>
                            <input
                              type="checkbox"
                              checked={industry.fbPositions.includes(position.value)}
                              onChange={() => setIndustry(index, { fbPositions: toggleList(industry.fbPositions, position.value) })}
                            />
                            <span>{position.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="meta-placement-set">
                        <div className="placement-title">Instagram</div>
                        {IG_POSITION_OPTIONS.map((position) => (
                          <label className="check-row" key={`${industry.key}-ig-${position.value}`}>
                            <input
                              type="checkbox"
                              checked={industry.igPositions.includes(position.value)}
                              onChange={() => setIndustry(index, { igPositions: toggleList(industry.igPositions, position.value) })}
                            />
                            <span>{position.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </CollapsibleCard>
  );
}
