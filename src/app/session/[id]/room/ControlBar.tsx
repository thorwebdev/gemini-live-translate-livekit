"use client";

import { useState } from "react";
import {
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  CamOffIcon,
  CamOnIcon,
  CaptionsIcon,
  LeaveIcon,
  LinkIcon,
  MicOffIcon,
  MicOnIcon,
} from "./icons";

export default function ControlBar({
  onLeave,
  inviteUrl,
  captionsOpen,
  onToggleCaptions,
}: {
  onLeave: () => void;
  inviteUrl: string;
  captionsOpen: boolean;
  onToggleCaptions: () => void;
}) {
  const { localParticipant, microphoneTrack, cameraTrack } = useLocalParticipant();
  const room = useRoomContext();
  const [copied, setCopied] = useState(false);

  const micOn = !!microphoneTrack && !microphoneTrack.isMuted;
  const camOn =
    !!cameraTrack &&
    cameraTrack.source === Track.Source.Camera &&
    !cameraTrack.isMuted;

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
    <div className="control-bar">
      <CtrlButton
        active={micOn}
        onClick={toggleMic}
        label={micOn ? "Mic on" : "Mic off"}
        icon={micOn ? <MicOnIcon /> : <MicOffIcon />}
      />
      <CtrlButton
        active={camOn}
        onClick={toggleCam}
        label={camOn ? "Camera on" : "Camera off"}
        icon={camOn ? <CamOnIcon /> : <CamOffIcon />}
      />
      <CtrlButton
        active={captionsOpen}
        onClick={onToggleCaptions}
        label="Captions"
        icon={<CaptionsIcon />}
      />
      <CtrlButton
        active={false}
        onClick={copyInvite}
        label={copied ? "Copied" : "Invite"}
        icon={<LinkIcon />}
      />
      <button
        className="ctrl ctrl--warning ctrl-leave"
        onClick={leave}
        title="Leave the call"
        aria-label="Leave"
      >
        <span className="ctrl-icon">
          <LeaveIcon />
        </span>
        <span>Leave</span>
      </button>
    </div>
  );
}

function CtrlButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      className={`ctrl${active ? " ctrl--active" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <span className="ctrl-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
