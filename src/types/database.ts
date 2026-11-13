// Generated schema types live in database.gen.ts (`pnpm db:types`); this file
// adds the aliases the app uses.
import type { Database } from "./database.gen";

export type { Database, Json } from "./database.gen";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type AccountStatus = Database["public"]["Enums"]["account_status"];
