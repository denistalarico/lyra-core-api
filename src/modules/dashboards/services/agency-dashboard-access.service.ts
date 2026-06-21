import { Injectable } from '@nestjs/common';
import type { PlatformContextResponse } from '../../platform/types/platform-context.types';
import type {
  AgencyDashboardAccess,
  AgencyDashboardPreset,
} from '../types';

@Injectable()
export class AgencyDashboardAccessService {
  resolvePreset(role: string): AgencyDashboardPreset {
    if (role === 'owner') {
      return 'executive';
    }

    if (role === 'admin' || role === 'administrator') {
      return 'agency';
    }

    if (role === 'manager') {
      return 'management';
    }

    return 'member';
  }

  resolveAccess(
    platformContext: PlatformContextResponse,
  ): AgencyDashboardAccess {
    const role = platformContext.user.role;
    const agencyProduct = platformContext.products.find(
      (product) => product.key === 'agency',
    );

    const canViewDashboard =
      agencyProduct?.access === 'available' &&
      (agencyProduct.status === 'active' ||
        agencyProduct.status === 'trial');

    const isExecutive = role === 'owner' || role === 'admin';
    const isManager = role === 'manager';

    return {
      canViewDashboard,
      canViewFinance: canViewDashboard && isExecutive,
      canViewProfitability: canViewDashboard && isExecutive,
      canViewCommercial:
        canViewDashboard && (isExecutive || isManager),
      canViewTeam:
        canViewDashboard && (isExecutive || isManager),
      canViewPortfolio:
        canViewDashboard && (isExecutive || isManager),
      canViewCrossProductSignals:
        canViewDashboard && isExecutive,
      canManageLayout:
        canViewDashboard && isExecutive,
    };
  }
}
