// Settings that protect patient data, checked at start-up. A misconfigured
// server exits with the reason instead of staying up and answering every
// request with an error, which would hide the problem from Docker and from
// whoever is watching.
import { assertKeyring } from "./lib/keyring";
import { databaseSsl } from "./lib/db/ssl";

export async function checkProtections() {
  try {
    assertKeyring();
    for (const name of ["DATABASE_URL", "PLATFORM_DATABASE_URL", "PROVISIONER_DATABASE_URL"]) {
      if (process.env[name]) databaseSsl(process.env[name]);
    }
  } catch (error) {
    console.error(`NuvaLyf will not start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
