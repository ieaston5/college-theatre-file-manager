/**
 * The Google API clients the hub uses, one package each, loaded on first use.
 *
 * Two things are going on here, both about cold starts.
 *
 * The hub talks to seven Google APIs. The umbrella `googleapis` package ships
 * the generated client for roughly two hundred and fifty of them, and the
 * whole lot gets traced into the serverless function of every route that can
 * reach the Drive stack: 28 MB of the 49 MB those functions weighed, all of
 * which the host has to fetch and unpack before running a line of our code.
 * The per-API packages below come to about 5 MB together, are generated from
 * the same source by the same tool, and expose the identical clients.
 *
 * They are also loaded lazily. Evaluating the umbrella package cost the best
 * part of a second; these cost tens of milliseconds, and nothing needs one
 * until the hub actually calls Google, which is never during a page render.
 * `import()` is memoised by the module system, so the cost is paid once per
 * server instance.
 *
 * Each accessor returns the same factory the old `google.<api>` property was:
 * call it with `{ version, auth }` exactly as before.
 */

export async function driveApi() {
  return (await import("@googleapis/drive")).drive;
}

export async function docsApi() {
  return (await import("@googleapis/docs")).docs;
}

export async function sheetsApi() {
  return (await import("@googleapis/sheets")).sheets;
}

export async function slidesApi() {
  return (await import("@googleapis/slides")).slides;
}

export async function formsApi() {
  return (await import("@googleapis/forms")).forms;
}

export async function oauth2Api() {
  return (await import("@googleapis/oauth2")).oauth2;
}

export async function gmailApi() {
  return (await import("@googleapis/gmail")).gmail;
}

/**
 * The OAuth2 client constructor. Every one of these packages re-exports the
 * same `auth` helper from google-auth-library, so which it comes from does not
 * matter; oauth2 is the smallest of them.
 */
export async function OAuth2Ctor() {
  return (await import("@googleapis/oauth2")).auth.OAuth2;
}
