/**
 * Placeholder for portal ad SDKs (CrazyGames / Poki / GameDistribution).
 * Nothing is wired up yet: `available` is false, so the game hides ad buttons.
 * To integrate a portal: load its SDK in index.html and implement these three calls.
 */
export const Ads = {
  available: false,

  /** Called when gameplay starts/stops (portals want this for analytics). */
  gameplayStart(): void {},
  gameplayStop(): void {},

  /** Between levels. Resolves when the ad is closed (or immediately when no ads). */
  async interstitial(): Promise<void> {},

  /** Rewarded ad. Resolves true when the player watched it to the end. */
  async rewarded(): Promise<boolean> {
    return false;
  },
};
