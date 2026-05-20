"use client";

import type { RemoteParticipant } from "livekit-client";
import ParticipantTile from "./ParticipantTile";

export default function VideoGrid({
  participants,
}: {
  participants: RemoteParticipant[];
}) {
  if (participants.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <p className="display display-md" style={{ marginBottom: 8 }}>
            Waiting for others
          </p>
          <p className="body">
            Share the invite link from the control bar below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        padding: "16px 24px",
        display: "grid",
        gridTemplateColumns: gridColumns(participants.length),
        gap: 16,
        alignContent: "stretch",
      }}
    >
      {participants.map((p) => (
        <ParticipantTile key={p.identity} participant={p} />
      ))}
    </div>
  );
}

function gridColumns(n: number): string {
  // 1 -> full-bleed; 2 -> two columns; 3-4 -> 2x2; 5-9 -> 3x3; 10+ -> 4 cols
  if (n <= 1) return "1fr";
  if (n <= 4) return "1fr 1fr";
  if (n <= 9) return "1fr 1fr 1fr";
  return "1fr 1fr 1fr 1fr";
}
