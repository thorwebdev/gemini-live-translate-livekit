"use client";

import { useState } from "react";
import {
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import { Track } from "livekit-client";

export default function ControlBar({
  onLeave,
  inviteUrl,
}: {
  onLeave: () => void;
  inviteUrl: string;
}) {
  const { localParticipant, microphoneTrack, cameraTrack } = useLocalParticipant();
  const room = useRoomContext();
  const [copied, setCopied] = useState(false);

  const micOn = !!microphoneTrack && !microphoneTrack.isMuted;
  const camOn =
    !!cameraTrack && cameraTrack.source === Track.Source.Camera && !cameraTrack.isMuted;

  async function toggleMic() {
    await localParticipant.setMicrophoneEnabled(!micOn);
  }
  async function toggleCam() {
    await localParticipant.setCameraEnabled(!camOn);
  }
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignored
    }
  }
  async function leave() {
    await room.disconnect();
    onLeave();
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 8,
        padding: "16px 24px",
        background: "var(--bg-elevated)",
        borderTop: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      <ControlButton
        active={micOn}
        onClick={toggleMic}
        label={micOn ? "Mute" : "Unmute"}
        icon={micOn ? "🎙️" : "🔇"}
      />
      <ControlButton
        active={camOn}
        onClick={toggleCam}
        label={camOn ? "Stop video" : "Start video"}
        icon={camOn ? "📹" : "🎥"}
      />
      <ControlButton
        active={false}
        onClick={copyInvite}
        label={copied ? "Copied!" : "Invite"}
        icon="🔗"
      />
      <button
        className="btn btn-danger"
        onClick={leave}
        style={{ marginLeft: 16 }}
      >
        Leave
      </button>
    </div>
  );
}

function ControlButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        padding: "8px 16px",
        background: active ? "var(--fg)" : "transparent",
        color: active ? "var(--bg)" : "var(--fg)",
        border: `1px solid ${active ? "var(--fg)" : "var(--border)"}`,
        cursor: "pointer",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        minWidth: 72,
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
