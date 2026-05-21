"use client";

import { useMemo } from "react";
import type { RemoteParticipant } from "livekit-client";
import ParticipantTile from "./ParticipantTile";

export default function VideoGrid({
  participants,
  myLang,
}: {
  participants: RemoteParticipant[];
  myLang: string;
}) {
  const layout = useMemo(() => deriveLayout(participants.length), [participants.length]);

  return (
    <div
      className="tile-grid"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        maxWidth: layout.maxWidth,
      }}
    >
      {participants.map((p) => (
        <ParticipantTile key={p.identity} participant={p} myLang={myLang} />
      ))}
    </div>
  );
}

/**
 * Pick column count + max grid width based on participant count.
 * Keeps tiles a sensible size — never the whole viewport on a 1:1 call.
 */
function deriveLayout(n: number): { cols: number; maxWidth: string } {
  if (n <= 1) return { cols: 1, maxWidth: "min(900px, 80vw)" };
  if (n <= 2) return { cols: 2, maxWidth: "min(1400px, 92vw)" };
  if (n <= 4) return { cols: 2, maxWidth: "min(1200px, 92vw)" };
  if (n <= 6) return { cols: 3, maxWidth: "min(1400px, 96vw)" };
  if (n <= 9) return { cols: 3, maxWidth: "min(1600px, 96vw)" };
  return { cols: 4, maxWidth: "min(1700px, 96vw)" };
}
