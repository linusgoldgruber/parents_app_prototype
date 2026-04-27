import { clientEnv, hasMatrixConfig } from "./env";
import type { ChatMessage, MatrixRoom } from "../types/app";

async function matrixRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasMatrixConfig()) {
    throw new Error("Matrix config missing");
  }

  const response = await fetch(`${clientEnv.matrixBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientEnv.matrixAccessToken}`,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Matrix request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export async function listJoinedRooms(): Promise<MatrixRoom[]> {
  const data = await matrixRequest<{ joined_rooms: string[] }>("/_matrix/client/v3/joined_rooms");
  return data.joined_rooms.map((room_id) => ({ room_id }));
}

export async function listRoomMessages(roomId: string, limit = 30): Promise<ChatMessage[]> {
  const encodedRoom = encodeURIComponent(roomId);
  const data = await matrixRequest<{ chunk?: Array<Record<string, unknown>> }>(
    `/_matrix/client/v3/rooms/${encodedRoom}/messages?dir=b&limit=${limit}`
  );

  const events = data.chunk ?? [];

  return events
    .filter((event) => event.type === "m.room.message")
    .map((event) => ({
      event_id: String(event.event_id ?? ""),
      sender: String(event.sender ?? ""),
      body: String((event.content as { body?: string } | undefined)?.body ?? ""),
      ts: Number(event.origin_server_ts ?? 0)
    }))
    .reverse();
}

export async function sendMessage(roomId: string, body: string): Promise<void> {
  const encodedRoom = encodeURIComponent(roomId);
  const txnId = `parentsapp-${Date.now()}`;
  await matrixRequest(
    `/_matrix/client/v3/rooms/${encodedRoom}/send/m.room.message/${txnId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        msgtype: "m.text",
        body
      })
    }
  );
}
