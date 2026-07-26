import { AgencyDashboardAccessService } from './agency-dashboard-access.service';

describe('AgencyDashboardAccessService presets', () => {
  const service = new AgencyDashboardAccessService();

  it.each(['owner', 'admin', 'administrator'])(
    'maps the executive role %s to the implemented executive dashboard',
    (role) => {
      expect(service.resolvePreset(role)).toBe('executive');
    },
  );

  it('keeps management and member presets scoped to their dashboards', () => {
    expect(service.resolvePreset('manager')).toBe('management');
    expect(service.resolvePreset('member')).toBe('member');
  });
});
