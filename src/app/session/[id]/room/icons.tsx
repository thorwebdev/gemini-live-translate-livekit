/** Sparse, line-based icons matching the editorial aesthetic. 1px strokes. */

const baseProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function MicOnIcon() {
  return (
    <svg {...baseProps}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function MicOffIcon() {
  return (
    <svg {...baseProps}>
      <path d="M9 5a3 3 0 0 1 6 0v5" />
      <path d="M15 12.5a3 3 0 0 1-6 0V8" />
      <path d="M5 11a7 7 0 0 0 7 7" />
      <path d="M19 11v0a6.97 6.97 0 0 1-1.8 4.7" />
      <path d="M3 3l18 18" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function CamOnIcon() {
  return (
    <svg {...baseProps}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-2v8l-5-2z" />
    </svg>
  );
}

export function CamOffIcon() {
  return (
    <svg {...baseProps}>
      <path d="M16 10l5-2v8l-5-2v-4" />
      <path d="M16 16v-2.5" />
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg {...baseProps}>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" />
    </svg>
  );
}

export function LeaveIcon() {
  return (
    <svg {...baseProps}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h12" />
    </svg>
  );
}

export function CaptionsIcon() {
  return (
    <svg {...baseProps}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 13a2 2 0 1 1 0-2" />
      <path d="M14 13a2 2 0 1 1 0-2" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...baseProps}>
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg {...baseProps} width={12} height={12}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
