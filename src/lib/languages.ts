import { NATIVE_LANG } from "./config";

export interface Language {
  code: string;
  name: string;
  flag: string;
}

/** Listener's choice for "no translation, hear everyone natively." */
export const NATIVE_OPTION: Language = {
  code: NATIVE_LANG,
  name: "None — Native",
  flag: "👂",
};

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "tr", name: "Turkish", flag: "🇹🇷" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
  { code: "pl", name: "Polish", flag: "🇵🇱" },
  { code: "sv", name: "Swedish", flag: "🇸🇪" },
];

/** Options shown in the pre-flight language picker. */
export const PICKER_LANGUAGES: Language[] = [...SUPPORTED_LANGUAGES, NATIVE_OPTION];

export function getLanguageByCode(code: string): Language | undefined {
  if (code === NATIVE_OPTION.code) return NATIVE_OPTION;
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
}
