import { derived } from 'svelte/store';
import { permissions } from './session.js';

export const PERMISSIONS = {
  MENU_DASHBOARD:  'menu.dashboard',
  MENU_RECRUITING: 'menu.recruiting',
  MENU_ROADSHOW:   'menu.roadshow',
  MENU_INVENTORY:  'menu.inventory',
  MENU_FINANCE:    'menu.finance',
  MENU_APPROVALS:  'menu.approvals',
  MENU_AUDIT:      'menu.audit',
  MENU_ADMIN:      'menu.admin',

  CANDIDATE_READ:   'candidate.read',
  CANDIDATE_WRITE:  'candidate.write',
  FINANCE_READ:     'finance.read',
  INVENTORY_READ:   'inventory.read',
  INVENTORY_WRITE:  'inventory.write',
  APPROVAL_APPROVE: 'approval.approve',
  APPROVAL_REJECT:  'approval.reject',
  AUDIT_READ:       'audit.read',
  USER_MANAGE:      'user.manage'
};

export const MENU_ITEMS = [
  { key: 'dashboard',  label: 'Dashboard',  permission: PERMISSIONS.MENU_DASHBOARD  },
  { key: 'recruiting', label: 'Recruiting', permission: PERMISSIONS.MENU_RECRUITING },
  { key: 'roadshow',   label: 'Roadshows',  permission: PERMISSIONS.MENU_ROADSHOW   },
  { key: 'inventory',  label: 'Inventory',  permission: PERMISSIONS.MENU_INVENTORY  },
  { key: 'finance',    label: 'Finance',    permission: PERMISSIONS.MENU_FINANCE    },
  { key: 'approvals',  label: 'Approvals',  permission: PERMISSIONS.MENU_APPROVALS  },
  { key: 'audit',      label: 'Audit',      permission: PERMISSIONS.MENU_AUDIT      },
  { key: 'admin',      label: 'Admin',      permission: PERMISSIONS.MENU_ADMIN      }
];

export const can = derived(permissions, ($perms) => (code) => $perms.has(code));

export const visibleMenu = derived(permissions, ($perms) =>
  MENU_ITEMS.filter((m) => $perms.has(m.permission))
);
