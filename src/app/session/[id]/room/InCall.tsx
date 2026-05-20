"use client";

import { useEffect, useState } from "react";
import {
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { ParticipantKind } from "livekit-client";
import { PARTICIPANT_LANG_ATTR } from "@/lib/config";
import { useTranslationRouting } from "./useTranslationRouting";
import VideoGrid from "./VideoGrid";
import SelfView from "./SelfView";
import ControlBar from "./ControlBar";
import LanguagePill from "./LanguagePill";

export default function InCall({
  initialLang,
  onLeave,
}: {
  initialLang: string;
  onLeave: () => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const remotes = useRemoteParticipants();
  const [lang, setLang] = useState(initialLang);

  // Push the initial language onto the local participant's attributes once
  // we're connected so the agent and other peers can see it.
  useEffect(() => {
    if (!localParticipant) return;
    localParticipant.setAttributes({ [PARTICIPANT_LANG_ATTR]: lang });
  }, [localParticipant, lang]);

  // Subscribe/unsubscribe to the right audio tracks for the current language.
  useTranslationRouting(lang);

  const humanRemotes = remotes.filter((p) => p.kind !== ParticipantKind.AGENT);
  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/session/${room.name}`
      : "";

  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      {/* Top chrome */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div className="mono">
          {humanRemotes.length + 1} {humanRemotes.length === 0 ? "person" : "people"}
        </div>
        <LanguagePill value={lang} onChange={setLang} />
      </div>

      {/* Main grid */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <VideoGrid participants={humanRemotes} />
        <SelfView />
      </div>

      {/* Bottom control bar */}
      <ControlBar onLeave={onLeave} inviteUrl={inviteUrl} />
    </div>
  );
}
