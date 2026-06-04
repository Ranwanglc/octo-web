import React, { useState, useCallback } from "react";
import { Button, Select, Input, InputNumber } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import { SummaryMode } from "../types/summary";
import type {
    CreateScheduleParams,
    SourceItem,
    SummaryModeType,
    ScheduleUnit,
} from "../types/summary";
import {
    getTimeRangeTypeOptions,
    scheduleToParams,
    scheduleItemToConfig,
    validateScheduleConfig,
} from "../utils/summaryHelpers";
import SourceSelector from "./SourceSelector";

interface ScheduleFormProps {
    initialValues?: Partial<CreateScheduleParams>;
    onSubmit: (values: CreateScheduleParams) => void;
    onCancel?: () => void;
    loading?: boolean;
}

const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    const val = `${String(h).padStart(2, "0")}:${m}`;
    return { value: val, label: val };
});

const ScheduleForm: React.FC<ScheduleFormProps> = ({
    initialValues,
    onSubmit,
    onCancel,
    loading,
}) => {
    const { t } = useI18n();
    const [title, setTitle] = useState(initialValues?.title || "");
    const [summaryMode, setSummaryMode] = useState<SummaryModeType>(
        initialValues?.summary_mode || SummaryMode.BY_GROUP,
    );

    // 通用「数量 × 单位 + 时间」配置；从既有值回填（interval 优先，cron 降级）
    const initialConfig = scheduleItemToConfig({
        cron_expr: initialValues?.cron_expr || "",
        interval_days: initialValues?.interval_days,
        interval_months: initialValues?.interval_months,
        run_time: initialValues?.run_time,
    });
    const [every, setEvery] = useState<number>(initialConfig.every);
    const [unit, setUnit] = useState<ScheduleUnit>(initialConfig.unit);
    const [runTime, setRunTime] = useState<string>(initialConfig.time);

    const [timeRangeType, setTimeRangeType] = useState<1 | 2 | 3 | 4>(
        initialValues?.time_range_type || 2,
    );
    const [sources, setSources] = useState<SourceItem[]>(initialValues?.sources || []);
    const [errMsg, setErrMsg] = useState<string | null>(null);
    const timeRangeTypeOptions = getTimeRangeTypeOptions();

    const unitOptions: { value: ScheduleUnit; label: string }[] = [
        { value: "day", label: t("summary.schedule.config.unitDay") },
        { value: "week", label: t("summary.schedule.config.unitWeek") },
        { value: "month", label: t("summary.schedule.config.unitMonth") },
    ];

    const handleSubmit = useCallback(() => {
        if (sources.length === 0) return;
        const config = { unit, every: Math.max(1, Math.floor(every || 1)), time: runTime };
        const verr = validateScheduleConfig(config);
        if (verr) {
            setErrMsg(verr);
            return;
        }
        setErrMsg(null);
        const { cron_expr, interval_days, interval_months, run_time } = scheduleToParams(config);

        onSubmit({
            title: title.trim(),
            summary_mode: summaryMode,
            cron_expr,
            interval_days,
            interval_months,
            run_time,
            time_range_type: timeRangeType,
            sources,
        });
    }, [title, summaryMode, unit, every, runTime, timeRangeType, sources, onSubmit]);

    return (
        <div className="summary-schedule-form">
            <div className="summary-form-field">
                <label>{t("summary.schedule.form.title")}</label>
                <Input
                    value={title}
                    onChange={(val) => setTitle(val.slice(0, 1000))}
                    maxLength={1000}
                    placeholder={t("summary.schedule.form.titlePlaceholder")}
                />
                {title.length >= 1000 && (
                    <div style={{ color: "var(--semi-color-danger)", fontSize: 12, marginTop: 4 }}>
                        {t("summary.common.charLimitReached", { values: { count: 1000 } })}
                    </div>
                )}
            </div>

            <div className="summary-form-field">
                <label>{t("summary.schedule.form.mode")}</label>
                <Select value={summaryMode} onChange={(v) => setSummaryMode(v as SummaryModeType)}>
                    <Select.Option value={SummaryMode.BY_GROUP}>{t("summary.mode.byGroup")}</Select.Option>
                    <Select.Option value={SummaryMode.BY_PERSON}>{t("summary.mode.byPerson")}</Select.Option>
                </Select>
            </div>

            <div className="summary-form-field">
                <label>{t("summary.schedule.form.frequency")}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--semi-color-text-2)", fontSize: 14 }}>
                        {t("summary.schedule.config.everyPrefix")}
                    </span>
                    <InputNumber
                        min={1}
                        max={9999}
                        precision={0}
                        value={every}
                        onChange={(v) => setEvery(typeof v === "number" ? v : 1)}
                        style={{ width: 96 }}
                    />
                    <Select
                        value={unit}
                        onChange={(v) => setUnit(v as ScheduleUnit)}
                        style={{ width: 110 }}
                        optionList={unitOptions}
                    />
                    <span style={{ color: "var(--semi-color-text-2)", fontSize: 14 }}>
                        {t("summary.schedule.config.atPrefix")}
                    </span>
                    <Select
                        value={runTime}
                        onChange={(v) => setRunTime(v as string)}
                        style={{ width: 120 }}
                        optionList={timeOptions}
                    />
                </div>
                {errMsg && (
                    <div style={{ color: "var(--semi-color-danger)", fontSize: 12, marginTop: 4 }}>
                        {errMsg}
                    </div>
                )}
            </div>

            <div className="summary-form-field">
                <label>{t("summary.schedule.form.timeRange")}</label>
                <Select
                    value={timeRangeType}
                    onChange={(v) => setTimeRangeType(v as 1 | 2 | 3 | 4)}
                    style={{ width: "100%" }}
                >
                    {timeRangeTypeOptions.map((opt) => (
                        <Select.Option key={opt.value} value={opt.value}>
                            {opt.label}
                        </Select.Option>
                    ))}
                </Select>
            </div>

            <div className="summary-form-field">
                <label>{t("summary.schedule.form.source")}</label>
                <SourceSelector value={sources} onChange={setSources} />
            </div>

            <div className="summary-form-actions">
                {onCancel && (
                    <Button onClick={onCancel} style={{ marginRight: 8 }}>
                        {t("summary.common.cancel")}
                    </Button>
                )}
                <Button
                    theme="solid"
                    onClick={handleSubmit}
                    loading={loading}
                    disabled={sources.length === 0}
                >
                    {t("summary.common.save")}
                </Button>
            </div>
        </div>
    );
};

export default ScheduleForm;
