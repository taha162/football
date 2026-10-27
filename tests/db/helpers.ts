import { afterAll } from "vitest";
import { closeDb } from "../shared/db";

export * from "../shared/db";

afterAll(closeDb);
