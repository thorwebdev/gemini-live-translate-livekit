"use client";

import { PICKER_LANGUAGES, getLanguageByCode } from "@/lib/languages";
import { ChevronDownIcon } from "./icons";

export default function LanguagePill({
  value,
  onChange,
}: {
  value: string;
  onChange: (lang: string) => void;
}) {
  const current = getLanguageByCode(value);

  return (
    <label className="lang-pill">
      <span className="lang-pill-prefix">Lang</span>
      <span className="lang-pill-flag" aria-hidden>
        {current?.flag ?? "🌐"}
      </span>
      <span className="lang-pill-name">{current?.name ?? "Pick language"}</span>
      <span className="lang-pill-chevron" aria-hidden>
        <ChevronDownIcon />
      </span>
      <select
        className="lang-pill-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
