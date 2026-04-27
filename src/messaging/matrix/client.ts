import { createClient, MatrixClient } from "matrix-js-sdk";
import { env } from "../../config/env.js";

let client: MatrixClient | null = null;

export function getMatrixClient(): MatrixClient {
  if (client) {
    return client;
  }

  client = createClient({
    baseUrl: env.MATRIX_HOMESERVER_URL,
    accessToken: env.MATRIX_ACCESS_TOKEN,
    userId: env.MATRIX_USER_ID,
    deviceId: env.MATRIX_DEVICE_ID
  });

  return client;
}

export async function startMatrixSync(): Promise<void> {
  const matrix = getMatrixClient();
  await matrix.startClient({ initialSyncLimit: 20 });
}
