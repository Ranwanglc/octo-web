import React, { Component } from "react";
import { Modal, Select, Button, InputNumber, Toast } from "@douyinfe/semi-ui";
import { I18nContext } from "@octo/base";
import type { ScheduleConfig, ScheduleUnit } from "../types/summary";
import { validateScheduleConfig } from "../utils/summaryHelpers";

interface Props {
    visible: boolean;
    value: ScheduleConfig;
    onConfirm: (config: ScheduleConfig) => void;
    onCancel: () => void;
}

interface State {
    local: ScheduleConfig;
}

const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    const val = `${String(h).padStart(2, "0")}:${m}`;
    return { value: val, label: val };
});

const DEFAULT_CONFIG: ScheduleConfig = { unit: "week", every: 1, time: "09:00" };

export default class ScheduleConfigModal extends Component<Props, State> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: State = {
        local: { ...DEFAULT_CONFIG },
    };

    componentDidUpdate(prevProps: Props) {
        if (this.props.visible && !prevProps.visible) {
            this.setState({ local: { ...DEFAULT_CONFIG, ...this.props.value } });
        }
    }

    handleConfirm = () => {
        const { t } = this.context;
        const err = validateScheduleConfig(this.state.local);
        if (err) {
            Toast.error(err);
            return;
        }
        // 收敛为正整数后再提交
        const local = { ...this.state.local, every: Math.max(1, Math.floor(this.state.local.every || 1)) };
        this.props.onConfirm(local);
    };

    updateLocal(patch: Partial<ScheduleConfig>) {
        this.setState({ local: { ...this.state.local, ...patch } });
    }

    render() {
        const { visible, onCancel } = this.props;
        const { local } = this.state;
        const { t } = this.context;

        const labelStyle: React.CSSProperties = {
            width: 88,
            flexShrink: 0,
            color: "var(--semi-color-text-1)",
            fontSize: 14,
        };

        const rowStyle: React.CSSProperties = {
            display: "flex",
            alignItems: "center",
            marginBottom: 16,
        };

        const inlineStyle: React.CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            flexWrap: "wrap",
        };

        const prefixStyle: React.CSSProperties = {
            whiteSpace: "nowrap",
            color: "var(--semi-color-text-2)",
            fontSize: 14,
        };

        const unitOptions: { value: ScheduleUnit; label: string }[] = [
            { value: "day", label: t("summary.schedule.config.unitDay") },
            { value: "week", label: t("summary.schedule.config.unitWeek") },
            { value: "month", label: t("summary.schedule.config.unitMonth") },
        ];

        return (
            <Modal
                title={t("summary.schedule.config.title")}
                visible={visible}
                onCancel={onCancel}
                width={460}
                footer={
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <Button onClick={onCancel}>{t("summary.common.cancel")}</Button>
                        <Button theme="solid" onClick={this.handleConfirm}>{t("summary.common.save")}</Button>
                    </div>
                }
            >
                <div style={{ color: "var(--semi-color-text-2)", fontSize: 13, marginBottom: 20 }}>
                    {t("summary.schedule.config.desc")}
                </div>

                {/* 频率：每 [N] [天/周/月] */}
                <div style={rowStyle}>
                    <span style={labelStyle}>{t("summary.schedule.config.frequency")}</span>
                    <div style={inlineStyle}>
                        <span style={prefixStyle}>{t("summary.schedule.config.everyPrefix")}</span>
                        <InputNumber
                            min={1}
                            max={9999}
                            precision={0}
                            value={local.every}
                            onChange={(v) => this.updateLocal({ every: typeof v === "number" ? v : 1 })}
                            style={{ width: 96 }}
                        />
                        <Select
                            value={local.unit}
                            onChange={(v) => this.updateLocal({ unit: v as ScheduleUnit })}
                            style={{ width: 110 }}
                            optionList={unitOptions}
                        />
                    </div>
                </div>

                {/* 时间：在 HH:MM 跑 */}
                <div style={{ ...rowStyle, marginBottom: 0 }}>
                    <span style={labelStyle}>{t("summary.schedule.config.time")}</span>
                    <div style={inlineStyle}>
                        <span style={prefixStyle}>{t("summary.schedule.config.atPrefix")}</span>
                        <Select
                            value={local.time}
                            onChange={(v) => this.updateLocal({ time: v as string })}
                            style={{ flex: 1, minWidth: 120 }}
                            optionList={timeOptions}
                        />
                    </div>
                </div>
            </Modal>
        );
    }
}
