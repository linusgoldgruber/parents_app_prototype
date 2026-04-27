import "dotenv/config";
import { startMatrixSync } from "./messaging/matrix/client.js";

async function bootstrap(): Promise<void> {
  await startMatrixSync();
  process.stdout.write("ParentsAPP backend scaffold started with Matrix sync enabled.\n");
}

bootstrap().catch((error) => {
  console.error("Failed to bootstrap ParentsAPP scaffold", error);
  process.exit(1);
});
