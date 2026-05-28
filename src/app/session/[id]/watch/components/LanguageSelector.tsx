"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { SUPPORTED_LANGUAGES, getLanguageByCode } from "@/lib/languages";

interface LanguageSelectorProps {
  sessionId: string;
  currentLanguage: string;
  onLanguageChange: (
    languageCode: string,
    translatorIdentity: string | null
  ) => void;
}

export default function LanguageSelector({
  sessionId,
  currentLanguage,
  onLanguageChange,
}: LanguageSelectorProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeLanguageRef = useRef(currentLanguage);

  // Keep ref in sync with current language
  useEffect(() => {
    activeLanguageRef.current = currentLanguage;
  }, [currentLanguage]);

  // Unsubscribe on unmount (attendee disconnects)
  useEffect(() => {
    return () => {
      const lang = activeLanguageRef.current;
      if (lang && lang !== "original") {
        const payload = JSON.stringify({ sessionId, targetLanguage: lang });
        const blob = new Blob([payload], { type: "application/json" });
        // sendBeacon is reliable during page unload
        const sent = navigator.sendBeacon?.("/api/translate/unsubscribe", blob);
        if (!sent) {
          fetch("/api/translate/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => { });
        }
      }
    };
  }, [sessionId]);

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const langCode = e.target.value;
      const previousLanguage = activeLanguageRef.current;
      setError(null);

      if (langCode === "original") {
        // Unsubscribe from the current translation
        if (previousLanguage && previousLanguage !== "original") {
          fetch("/api/translate", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              targetLanguage: previousLanguage,
            }),
          }).catch(() => { });
        }
        onLanguageChange("original", null);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            targetLanguage: langCode,
            previousLanguage:
              previousLanguage !== "original" ? previousLanguage : undefined,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Translation request failed");
        }

        onLanguageChange(langCode, data.translatorIdentity);
      } catch (err) {
        setError((err as Error).message);
        console.error("Translation request error:", err);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, onLanguageChange]
  );

  const currentLang = getLanguageByCode(currentLanguage);

  return (
    <div style={{ width: "100%" }}>
      <label htmlFor="language-select" className="label" style={{ display: "block", marginBottom: 10 }}>
        Language
      </label>

      <div style={{ position: "relative" }}>
        <select
          id="language-select"
          className="select-field"
          value={currentLanguage}
          onChange={handleChange}
          disabled={loading}
          style={{ opacity: loading ? 0.5 : 1 }}
        >
          <option value="original">Original audio</option>
          <optgroup label="Translations">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name} {lang.flag}
              </option>
            ))}
          </optgroup>
        </select>

        {loading && (
          <div style={{ position: "absolute", right: 40, top: "50%", transform: "translateY(-50%)" }}>
            <span className="spinner" />
          </div>
        )}
      </div>

      {/* State feedback */}
      <div style={{ marginTop: 10, minHeight: 20 }}>
        {currentLanguage !== "original" && currentLang && !loading && (
          <span className="status status--active">
            <span className="status-dot pulse" />
            Translating to {currentLang.name}
          </span>
        )}

        {loading && (
          <span className="status status--waiting">
            <span className="status-dot pulse" />
            Starting translation…
          </span>
        )}

        {error && (
          <span className="status status--error">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
