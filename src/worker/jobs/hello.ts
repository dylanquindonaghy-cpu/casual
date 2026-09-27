import { z } from "zod";

export const HELLO_QUEUE = "hello";

export const helloPayloadSchema = z.object({ name: z.string().min(1) });
export type HelloPayload = z.infer<typeof helloPayloadSchema>;

// Smoke-test job: proves the worker picks up and completes jobs.
export function handleHello(data: unknown): { greeting: string } {
  const { name } = helloPayloadSchema.parse(data);
  return { greeting: `hello ${name}` };
}
