import {
  MIN_PUBLICATIONS_FOR_BEST_DAY,
  emptyWeekdayBucket,
  pickBestWeekday,
  type SocialOrganicWeekdayBucket,
} from './social-organic-weekday.view';

const bucket = (
  weekday: number,
  publications: number,
  average: string | null,
): SocialOrganicWeekdayBucket => ({
  weekday,
  publications,
  total: average === null ? null : String(Number(average) * publications),
  average,
});

describe('pickBestWeekday', () => {
  it('names the weekday with the highest average', () => {
    expect(
      pickBestWeekday([
        bucket(1, 3, '10.0'),
        bucket(2, 3, '90.0'),
        bucket(3, 3, '40.0'),
      ]),
    ).toBe(2);
  });

  it('is not decided by how often the operator posted', () => {
    // The whole reason the card averages instead of summing. Monday has six
    // times the total views of Tuesday purely because there are six times as
    // many posts; Tuesday is still the better day to publish on.
    const monday = bucket(1, 12, '10.0');
    const tuesday = bucket(2, 2, '50.0');

    expect(Number(monday.total)).toBeGreaterThan(Number(tuesday.total));
    expect(pickBestWeekday([monday, tuesday])).toBe(2);
  });

  it('names nobody when the evidence is too thin', () => {
    // Two posts is a coin toss, and an operator will act on whatever it says.
    expect(pickBestWeekday([bucket(1, 1, '10.0'), bucket(3, 1, '90.0')])).toBe(
      null,
    );
  });

  it('names a day at exactly the threshold', () => {
    const buckets = [
      bucket(1, MIN_PUBLICATIONS_FOR_BEST_DAY - 1, '10.0'),
      bucket(4, 1, '90.0'),
    ];

    expect(pickBestWeekday(buckets)).toBe(4);
  });

  it('skips weekdays nothing was published on', () => {
    // An average of null is an absence of evidence, and must never win — a
    // weekday with no posts is not the best day to post.
    expect(
      pickBestWeekday([
        emptyWeekdayBucket(1),
        bucket(2, 8, '5.0'),
        emptyWeekdayBucket(3),
      ]),
    ).toBe(2);
  });

  it('breaks a tie toward the earlier weekday', () => {
    // Arbitrary but stable. Without it the answer would depend on row order
    // and the same data would name a different best day between page loads.
    expect(pickBestWeekday([bucket(2, 4, '20.0'), bucket(5, 4, '20.0')])).toBe(
      2,
    );
  });

  it('names nobody when enough was published but nothing reported views', () => {
    expect(pickBestWeekday([bucket(1, 5, null), bucket(2, 5, null)])).toBe(
      null,
    );
  });
});
