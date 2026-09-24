import { buildActivityView } from './social-organic-activity-read.service';
import { convertPacificHour } from './views/social-organic-activity.view';

const PACIFIC = 'America/Los_Angeles';
const SAO_PAULO = 'America/Sao_Paulo';

/**
 * The two activity charts, and the conversion that decides whether they are
 * useful or actively misleading.
 *
 * What is really under test is the timezone step. Meta indexes
 * `online_followers` by Pacific hour whatever the account's own zone, and the
 * chart's entire purpose is to name an hour somebody should post at. Show the
 * stored hour to a Brazilian account and the recommendation is four or five
 * hours early — not a rounding error, a wrong answer to the only question
 * asked.
 */
describe('follower activity', () => {
  describe('convertPacificHour', () => {
    it('moves the production peak from 8h Pacific to 12h in São Paulo', () => {
      // The figure measured against the live account on 2026-09-24. September
      // is Pacific daylight time and São Paulo has no DST, so the gap is four
      // hours.
      expect(
        convertPacificHour('2026-09-18', 8, PACIFIC, SAO_PAULO),
      ).toMatchObject({ date: '2026-09-18', hour: 12 });
    });

    it('moves the same hour to 13h in January, when the gap is five', () => {
      // The reason the conversion cannot be a stored constant: Pacific leaves
      // daylight time in November and the gap widens by an hour. A fixed
      // offset would be right for part of the year and wrong for the rest.
      expect(
        convertPacificHour('2027-01-15', 8, PACIFIC, SAO_PAULO),
      ).toMatchObject({ date: '2027-01-15', hour: 13 });
    });

    it('carries an hour past midnight into the next weekday', () => {
      // 22h Friday in Pacific is 02h Saturday in São Paulo. The weekday has to
      // follow the converted day: counting this hour under Friday would put
      // late-night activity on the wrong bar of the "melhor dia" chart.
      expect(
        convertPacificHour('2026-09-18', 22, PACIFIC, SAO_PAULO),
      ).toMatchObject({ date: '2026-09-19', hour: 2, weekday: 6 });
    });

    it('returns every hour unchanged when both zones are the same', () => {
      // Including across a DST boundary. The regression this pins: a single
      // correction pass resolves the instant against the offset on the wrong
      // side of the transition, which left every hour after it shifted by one
      // — 15 of 96 hours over four sample days, quietly moving the peak.
      for (const date of ['2026-03-08', '2026-11-01', '2026-06-15']) {
        for (let hour = 0; hour < 24; hour += 1) {
          const converted = convertPacificHour(date, hour, PACIFIC, PACIFIC);

          // 02:00 on the spring-forward day is the one exception: that
          // wall-clock time does not exist, and 03:00 is the honest answer.
          if (date === '2026-03-08' && hour === 2) {
            expect(converted.hour).toBe(3);
            continue;
          }

          expect(converted).toMatchObject({ date, hour });
        }
      }
    });
  });

  describe('buildActivityView', () => {
    /** One stored row, in the shape the SQL returns. */
    function row(date: string, hour: number, followers: number) {
      return {
        metric_date: date,
        hour_of_day: hour,
        source_timezone: PACIFIC,
        followers_online: String(followers),
      };
    }

    it('averages an hour across days rather than summing it', () => {
      // The stock rule. 10 and 20 followers online at the same hour on two days
      // is an average of 15, not 30 people: it is largely the same followers
      // counted twice.
      const view = buildActivityView('asset-1', PACIFIC, [
        row('2026-09-17', 8, 10),
        row('2026-09-18', 8, 20),
      ]);

      const eight = view.hours.find((point) => point.hour === 8);
      expect(eight).toMatchObject({ average: '15', sampleDays: 2 });
    });

    it('returns all 24 hours and all 7 weekdays even with one row', () => {
      // A chart draws axes from this, so a missing hour must arrive as a zero
      // with `sampleDays: 0` rather than as a gap the renderer has to invent a
      // position for.
      const view = buildActivityView('asset-1', PACIFIC, [
        row('2026-09-18', 8, 10),
      ]);

      expect(view.hours).toHaveLength(24);
      expect(view.weekdays).toHaveLength(7);
      expect(view.hours.find((point) => point.hour === 3)).toMatchObject({
        average: '0',
        sampleDays: 0,
      });
    });

    it('reports the window it averaged, in the asset timezone', () => {
      const view = buildActivityView('asset-1', SAO_PAULO, [
        row('2026-09-17', 8, 10),
        row('2026-09-18', 8, 20),
      ]);

      expect(view).toMatchObject({
        windowSince: '2026-09-17',
        windowUntil: '2026-09-18',
        daysCovered: 2,
        timezone: SAO_PAULO,
        sourceTimezone: PACIFIC,
        hasData: true,
      });
    });

    it('says it has no data rather than drawing a flat zero line', () => {
      // An empty grid and a grid of zeros are different claims. The first means
      // nothing was collected, which is the state of every asset before the
      // first sync; the second would assert this account has no followers
      // online at any hour, which is a statement about the account.
      const view = buildActivityView('asset-1', PACIFIC, []);

      expect(view.hasData).toBe(false);
      expect(view.daysCovered).toBe(0);
      expect(view.hours).toHaveLength(24);
    });

    it('bins a converted hour under the weekday it lands on', () => {
      // 23h Friday Pacific is 03h Saturday in São Paulo, so the whole reading
      // belongs to Saturday. Friday must not also count it.
      const view = buildActivityView('asset-1', SAO_PAULO, [
        row('2026-09-18', 23, 40),
      ]);

      expect(
        view.weekdays.find((point) => point.weekday === 6)?.sampleDays,
      ).toBe(1);
      expect(
        view.weekdays.find((point) => point.weekday === 5)?.sampleDays,
      ).toBe(0);
    });
  });
});
