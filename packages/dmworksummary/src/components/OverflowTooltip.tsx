import React, { useRef, useState, useCallback } from "react";
import { Tooltip } from "@douyinfe/semi-ui";

interface OverflowTooltipProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    as?: React.ElementType;
}

const OverflowTooltip: React.FC<OverflowTooltipProps> = ({ children, className, style, as: Component = "div" }) => {
    const containerRef = useRef<HTMLElement>(null);
    const [visible, setVisible] = useState(false);

    const handleVisibleChange = useCallback((newVisible: boolean) => {
        if (newVisible) {
            const el = containerRef.current;
            if (el && el.scrollWidth > el.clientWidth) {
                setVisible(true);
            }
        } else {
            setVisible(false);
        }
    }, []);

    return (
        <Tooltip
            content={containerRef.current?.textContent ?? ""}
            position="bottom"
            trigger="hover"
            visible={visible}
            onVisibleChange={handleVisibleChange}
        >
            <Component
                ref={containerRef}
                className={className}
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...style }}
            >
                {children}
            </Component>
        </Tooltip>
    );
};

export default OverflowTooltip;
