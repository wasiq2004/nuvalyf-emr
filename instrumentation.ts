// Runs once when the server starts, before it takes a request. The checks are
// Node-only, so they live in instrumentation-node.ts and load only there.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkProtections } = await import("./instrumentation-node");
    await checkProtections();
  }
}
