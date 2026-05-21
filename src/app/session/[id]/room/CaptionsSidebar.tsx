"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  useRemoteParticipants,
  useTextStream,
} from "@livekit/components-react";
import { getLanguageByCode } from "@/lib/languages";

const TRANSLATION_TOPIC = "lk.translation";

export default function CaptionsSidebar({
  open,
  onClose,
  myLang,
  peerLangs,
}: {
  open: boolean;
  onClose: () => void;
  myLang: string;
  peerLangs: Map<string, string | undefined>;
}) {
  const { textStreams } = useTextStream(TRANSLATION_TOPIC);
  const remotes = useRemoteParticipants();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Map identity -> display name
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of remotes) {
      map.set(p.identity, p.name || p.identity);
    }
    return map;
  }, [remotes]);

  // Each TextStream is one append from the agent. Group consecutive ones by
  // source_identity into a single visual block, but rebuild on every render —
  // the source list is small.
  const entries = useMemo(() => {
    const matching = textStreams
      .filter(
        (s) => s.streamInfo.attributes?.target_lang === myLang && !!s.text.trim(),
      )
      .sort((a, b) => a.streamInfo.timestamp - b.streamInfo.timestamp);

    type Entry = {
      key: string;
      sourceIdentity: string;
      text: string;
      sourceLang: string | undefined;
    };
    const out: Entry[] = [];
    for (const s of matching) {
      const source = s.streamInfo.attributes?.source_identity ?? s.participantInfo.identity;
      const sourceLang = peerLangs.get(source);
      const last = out[out.length - 1];
      if (last && last.sourceIdentity === source) {
        last.text += " " + s.text.trim();
      } else {
        out.push({
          key: s.streamInfo.id,
          sourceIdentity: source,
          text: s.text.trim(),
          sourceLang,
        });
      }
    }
    return out;
  }, [textStreams, myLang, peerLangs]);

  // Auto-scroll on new entries.
  useEffect(() => {
    if (!open || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [entries, open]);

  const myLangInfo = getLanguageByCode(myLang);

  return (
    <aside className={`captions${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="captions-header">
        <span>
          Captions {myLangInfo && `· ${myLangInfo.flag} ${myLangInfo.name}`}
        </span>
        <button
          className="captions-close"
          onClick={onClose}
          aria-label="Close captions"
        >
          Close
        </button>
      </div>
      <div ref={bodyRef} className="captions-body">
        {entries.length === 0 ? (
          <div className="captions-empty">
            No captions yet. Translation transcripts will appear here as people
            speak.
          </div>
        ) : (
          entries.map((entry) => (
            <div className="captions-entry" key={entry.key}>
              <div className="captions-speaker">
                <span className="captions-speaker-name">
                  {names.get(entry.sourceIdentity) ?? entry.sourceIdentity}
                </span>
                {entry.sourceLang && (
                  <span className="captions-speaker-lang">
                    {entry.sourceLang} → {myLang}
                  </span>
                )}
              </div>
              <p className="captions-text">{entry.text}</p>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
