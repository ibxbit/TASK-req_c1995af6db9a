// Extension hooks for data ingestion.
//
// In pure offline mode (files only) these are not used — ingestion reads from
// the local inbox directory and never opens a socket. They are defined so a
// future network-capable adapter can plug in per-source User-Agent, IP, and
// CAPTCHA strategies without touching the scheduler or parsers.

export const defaultHooks = {
  /**
   * Returns the User-Agent a fetcher should present for this source.
   * Offline mode: ignored. Consumers (future fetchers) may override.
   */
  userAgent(source) {
    return source?.user_agent || 'RoadshowOps-Ingestion/1.0 (+offline)';
  },

  /**
   * Advises the network layer how to route requests for this source —
   * 'direct', 'bind:<iface>', 'socks:<host:port>', etc. Offline: ignored.
   */
  ipStrategy(source) {
    return source?.ip_hint || 'direct';
  },

  /**
   * Advises how to handle CAPTCHA challenges. No external solvers are used.
   *   none    — source never challenges
   *   skip    — record as skipped, move on
   *   prompt  — flag for operator intervention (e.g., file a workflow task)
   *   manual  — caller presents challenge to a human
   */
  captcha(source) {
    const strategy = source?.captcha_strategy || 'none';
    return {
      strategy,
      message: strategy === 'prompt'
        ? 'Manual CAPTCHA resolution required — file a task for an operator.'
        : null
    };
  }
};

/**
 * Registry a deployment can mutate (e.g., during backend bootstrap) to replace
 * default hooks with environment-specific implementations.
 */
export const hooks = { ...defaultHooks };

export function setHooks(overrides) {
  Object.assign(hooks, overrides);
}
