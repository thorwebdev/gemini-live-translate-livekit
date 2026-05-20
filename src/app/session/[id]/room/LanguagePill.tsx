"use client";

import { PICKER_LANGUAGES, getLanguageByCode } from "@/lib/languages";

export default function LanguagePill({
  value,
  onChange,
}: {
  value: string;
  onChange: (lang: string) => void;
}) {
  const current = getLanguageByCode(value);

  return (
    <label
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 13,
      }}
    >
      <span aria-hidden>{current?.flag ?? "🌐"}</span>
      <span>{current?.name ?? "Pick language"}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          cursor: "pointer",
        }}
        aria-label="Listening language"
      >
        {PICKER_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.flag} {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
