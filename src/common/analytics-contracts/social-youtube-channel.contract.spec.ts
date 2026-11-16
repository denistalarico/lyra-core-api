import { ANALYTICS_CHANNELS, isChannelId } from "./social-channels";
import { SOCIAL_METRIC_CATALOG } from "./social-metric.catalog";

const metric = (id: string) => SOCIAL_METRIC_CATALOG.find((m) => m.id === id);

describe("YouTube analytics channel (YT3)", () => {
  it("is an integrated channel with the existing icon", () => {
    expect(isChannelId("youtube")).toBe(true);
    expect(ANALYTICS_CHANNELS.find((c) => c.id === "youtube")).toMatchObject({
      integrated: true,
      icon: "/integrations/webp/youtube.webp",
    });
  });

  it("adds only watch time and average duration beyond the views figure", () => {
    const own = SOCIAL_METRIC_CATALOG.filter(
      (m) => m.channels.length === 1 && m.channels[0] === "youtube",
    ).map((m) => m.id);
    expect(own.sort()).toEqual(
      ["yt_avg_view_duration", "yt_views", "yt_watch_time"].sort(),
    );
  });

  it("keeps the average non-additive and the totals additive", () => {
    expect(metric("yt_avg_view_duration")?.additive).toBe(false);
    expect(metric("yt_views")?.additive).toBe(true);
    expect(metric("yt_watch_time")?.additive).toBe(true);
  });

  it("reuses the Meta organic metrics whose meaning is the same", () => {
    for (const id of [
      "followers_count",
      "followers_gained",
      "followers_lost",
      "followers_delta",
      "organic_likes",
      "organic_comments",
      "organic_shares",
    ]) {
      expect(metric(id)?.channels).toContain("youtube");
    }
  });

  it("never offers Meta-only measurements on a YouTube dashboard", () => {
    for (const id of ["total_views", "organic_reach", "profile_views"]) {
      expect(metric(id)?.channels).not.toContain("youtube");
    }
  });
});
