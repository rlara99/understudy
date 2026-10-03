// Owner: Renzo. Load .env before anything else, and let it win over variables
// already set in the shell (e.g. a different ANTHROPIC_BASE_URL).
import dotenv from "dotenv";

dotenv.config({ override: true, quiet: true });
