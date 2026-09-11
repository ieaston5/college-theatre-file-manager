/**
 * `googleapis`, loaded on first use rather than at import time.
 *
 * The umbrella `googleapis` package pulls in the generated client for every
 * Google API there is; requiring it costs roughly half a second of CPU on a
 * warm machine and appreciably more on a cold serverless instance. Importing
 * it at the top of this module meant every route whose bundle reached the
 * Drive stack — which, through the document service, was most of the hub —
 * paid that on its first request, before a single query ran.
 *
 * Nothing needs the namespace until the hub actually talks to Google, and all
 * of those call sites are already async, so the load can wait until then.
 * The promise is kept so the work happens at most once per server instance.
 */
let pending: Promise<typeof import("googleapis")> | null = null;

export async function googleApis() {
  pending ??= import("googleapis");
  return (await pending).google;
}
