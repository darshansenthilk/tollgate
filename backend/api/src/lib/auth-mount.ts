import type { FastifyInstance } from "fastify";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

/**
 * Mounts Better Auth's own request handler at /api/auth/*.
 *
 * Registered as an ENCAPSULATED Fastify plugin so its "don't parse the body"
 * content-type parsers apply only here: Better Auth reads the raw Node request
 * stream itself, so Fastify must not consume it first. The agent routes live in
 * the parent scope and keep Fastify's default JSON body parser untouched.
 *
 * These routes are intentionally public — this IS the authentication surface
 * (sign-in / sign-up / get-session / sign-out). Better Auth applies its own
 * rate limiting + origin checks here (see auth.ts).
 */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const handler = toNodeHandler(auth);

  await app.register(async (scope) => {
    // Override the parsers inherited from the parent scope so the body stream
    // reaches Better Auth untouched. "*" alone wouldn't cover application/json,
    // which the parent already has a (consuming) parser for.
    const passthrough = (
      _req: unknown,
      _payload: unknown,
      done: (err: Error | null, body?: undefined) => void,
    ) => done(null, undefined);
    scope.addContentTypeParser(
      ["application/json", "application/x-www-form-urlencoded", "text/plain"],
      passthrough,
    );
    scope.addContentTypeParser("*", passthrough);

    scope.all("/api/auth/*", async (request, reply) => {
      // @fastify/cors computes the CORS response headers in an onRequest hook and
      // sets them on the Fastify *reply*. Better Auth writes straight to the raw
      // Node socket after reply.hijack(), which bypasses Fastify's send path — so
      // those headers would never reach the wire, and the browser blocks every
      // cross-origin /api/auth/* response ("Failed to fetch"). Mirror them onto
      // the raw response before handing off. (curl ignores CORS, which is why the
      // backend-only verification didn't catch this; the preflight OPTIONS works
      // because @fastify/cors answers it directly, without hijacking.)
      for (const name of [
        "access-control-allow-origin",
        "access-control-allow-credentials",
        "access-control-expose-headers",
        "vary",
      ]) {
        const value = reply.getHeader(name);
        if (value !== undefined) reply.raw.setHeader(name, value);
      }

      // Better Auth writes the response directly to the Node socket; hand the
      // reply off so Fastify doesn't also try to send one.
      reply.hijack();
      try {
        await handler(request.raw, reply.raw);
      } catch (err) {
        request.log.error(err, "better-auth handler error");
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.end();
        }
      }
    });
  });
}
