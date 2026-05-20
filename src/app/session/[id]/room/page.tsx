import { use } from "react";
import RoomClient from "./RoomClient";

export default function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <RoomClient sessionId={id} />;
}
