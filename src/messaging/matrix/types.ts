export type MatrixRoomType = "family.main" | "family.private" | "family.decision";

export interface MatrixRoomBinding {
  familyId: string;
  appConversationId: string;
  matrixRoomId: string;
  roomType: MatrixRoomType;
  createdAt: string;
}

export interface SendFamilyMessageInput {
  roomId: string;
  senderUserId: string;
  body: string;
}
