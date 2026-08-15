"use client";

import { useId, useState, type ReactNode } from "react";

import styles from "./contextual-help.module.css";

/**
 * Small, reusable terminology help for operational screens. Hover/focus is
 * transient; right-click or keyboard activation pins the explanation so an
 * operator can keep reading it while comparing the surrounding evidence.
 */
export function ContextualHelp(props: Readonly<{
  term: string;
  explanation: string;
  children?: ReactNode;
}>) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const togglePinned = () => setPinned((current) => !current);

  return <span className={styles.root}>
    <span
      className={styles.trigger}
      role="button"
      tabIndex={0}
      aria-describedby={open ? tooltipId : undefined}
      aria-expanded={pinned}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onContextMenu={(event) => { event.preventDefault(); togglePinned(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          togglePinned();
        }
        if (event.key === "Escape") setPinned(false);
      }}
    >{props.children ?? props.term}<span aria-hidden="true" className={styles.icon}>i</span></span>
    {open ? <span id={tooltipId} role="tooltip" className={styles.tooltip}>
      <strong>{props.term}</strong><span>{props.explanation}</span><small>Üzerine gelin; sağ tık veya Enter ile açıklamayı sabitleyin.</small>
    </span> : null}
  </span>;
}
