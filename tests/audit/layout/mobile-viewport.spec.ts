import { expect, test } from '../support/fixtures';
import { expectButtonTextContrast } from '../support/button-contrast';
import {
  EMPLOYEE_PHONE_ROUTES,
  MANAGER_PHONE_ROUTES,
} from '../../../lib/testing/selection/mobile-route-inventory';
import {
  expectAreaHeader,
  expectPhoneLayout,
  expectRequestControlsOnPhone,
  expectServiceDialogContracts,
  expectWarehouseCardsFit,
} from '../support/viewport-audit';
import { serviceCaseCaptureButton } from '../../golden/support/steps/service';

// Design canon (werkflow-design, "Density and layout"): every list page of the
// manager and every field-worker page fits a 375 px phone, with no page-level
// horizontal scroll, the shell owning the vertical scroll and no native form
// controls. The detail pages, the route aliases and the tablet and laptop
// widths run in audit:layout:viewports (viewport-details.spec.ts), so each
// group stays within four minutes. Tag: @AUDIT-LAYOUT.

test.describe('@AUDIT-LAYOUT phone viewport: no horizontal scroll, shell-owned scroll, no native controls', () => {
  for (const route of MANAGER_PHONE_ROUTES) {
    test(`admin ${route} fits a 375 px viewport`, async ({ adminPage, world }, testInfo) => {
      await expectPhoneLayout(adminPage, route, testInfo);
      if (route === '/inventar') await expectWarehouseCardsFit(adminPage, world, `${route} at 375 px`);
      if (route === '/service/faelle') {
        await expectButtonTextContrast(adminPage, serviceCaseCaptureButton(adminPage.getByRole('main')));
        await expect(adminPage.getByRole('dialog')).toHaveCount(0);
      }
      await expectServiceDialogContracts(adminPage, route);
      await expectAreaHeader(adminPage, route);
      if (route === '/anfragen') await expectRequestControlsOnPhone(adminPage);
    });
  }

  for (const route of EMPLOYEE_PHONE_ROUTES) {
    test(`employee ${route} fits a 375 px viewport`, async ({ employeePage }, testInfo) => {
      await expectPhoneLayout(employeePage, route, testInfo);
    });
  }
});
