import { Preset, type MatrixClient, Visibility } from "matrix-js-sdk";
import { getMatrixClient } from "./client.js";
import type { SendFamilyMessageInput } from "./types.js";

interface CreateFamilyRoomInput {
  familyId: string;
  displayName: string;
  topic?: string;
  isPrivate?: boolean;
}

export class MatrixMessagingService {
  constructor(private readonly matrix: MatrixClient = getMatrixClient()) {}

  async createFamilyRoom(input: CreateFamilyRoomInput): Promise<string> {
    const { room_id } = await this.matrix.createRoom({
      name: input.displayName,
      topic: input.topic,
      visibility: input.isPrivate ? Visibility.Private : Visibility.Public,
      preset: Preset.PrivateChat,
      initial_state: [
        {
          type: "m.room.topic",
          state_key: "",
          content: {
            topic: input.topic ?? `Family ${input.familyId} coordination room`
          }
        }
      ]
    });

    return room_id;
  }

  async sendMessage(input: SendFamilyMessageInput): Promise<string> {
    const txnId = `parentsapp-${Date.now()}`;
    const result = await this.matrix.sendTextMessage(input.roomId, input.body, txnId);

    return result.event_id;
  }
}
