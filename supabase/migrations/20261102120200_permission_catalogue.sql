-- Permission catalogue and built-in templates.
-- Spec: docs/spec/02-roles-permissions.md §2 (catalogue) and §3 (template matrix).
-- Keep src/lib/permissions.ts in sync with this list.

insert into public.permission_templates (code, name, description, is_builtin) values
  ('super_admin', 'Super admin', 'Manage roles and global settings. Holds every permission. Highly restricted.', true),
  ('operations', 'Operations', 'Driver approvals, trip monitoring and operational exceptions.', true),
  ('support', 'Support agent', 'Passenger and driver support with limited personal-data access.', true),
  ('finance', 'Finance', 'Read the ledger, reconcile collections, approve refunds and adjustments.', true),
  ('safety', 'Safety reviewer', 'Handle incidents and sensitive evidence under strict permissions.', true),
  ('analyst', 'Analyst', 'Read aggregated data. No financial mutations.', true);

-- Inserting a permission adds it to super_admin automatically (trigger).
-- templates: which built-in templates (besides super_admin) include it.
with catalogue (sort_order, code, module, description, is_high_impact, templates) as (
  values
    (10,  'dashboard.view',            'Dashboard',  'View the overview dashboard', false, array['operations','support','finance','safety','analyst']),
    (20,  'dispatch.view',             'Live ops',   'View the live map, searching requests and offer history', false, array['operations','support','safety']),
    (21,  'dispatch.intervene',        'Live ops',   'Re-dispatch or expire a request, take a driver offline', true, array['operations']),
    (30,  'passengers.view',           'Passengers', 'View passenger lists and profiles (PII masked)', false, array['operations','support','finance','safety']),
    (31,  'passengers.view_pii',       'Passengers', 'Reveal passenger phone and email (each reveal logged)', true, array['safety']),
    (32,  'passengers.update',         'Passengers', 'Edit passenger name, language and notes', false, array['operations','support']),
    (33,  'passengers.suspend',        'Passengers', 'Suspend or reactivate passenger accounts', true, array['operations','safety']),
    (40,  'drivers.view',              'Drivers',    'View driver lists and profiles (PII masked)', false, array['operations','support','finance','safety']),
    (41,  'drivers.view_pii',          'Drivers',    'Reveal driver phone, licence number and NID', true, array['operations','safety']),
    (42,  'drivers.update',            'Drivers',    'Edit driver operating details', false, array['operations']),
    (43,  'drivers.approve',           'Drivers',    'Approve or reject driver onboarding', true, array['operations']),
    (44,  'drivers.suspend',           'Drivers',    'Suspend or reactivate drivers', true, array['operations','safety']),
    (50,  'documents.view',            'Documents',  'View driver documents (signed URL, logged)', false, array['operations','safety']),
    (51,  'documents.review',          'Documents',  'Approve or reject driver documents', true, array['operations']),
    (60,  'vehicles.view',             'Vehicles',   'View vehicles', false, array['operations','support','safety']),
    (61,  'vehicles.manage',           'Vehicles',   'Create and edit vehicles, attach to drivers', false, array['operations']),
    (62,  'vehicles.verify',           'Vehicles',   'Verify, suspend or reactivate vehicles', true, array['operations']),
    (70,  'categories.manage',         'Catalogue',  'Manage vehicle categories', false, array['operations']),
    (80,  'zones.view',                'Zones',      'View service zones', false, array['operations','support','finance','safety','analyst']),
    (81,  'zones.manage',              'Zones',      'Create and edit zone boundaries and status', true, array['operations']),
    (90,  'fares.view',                'Fares',      'View fare rules', false, array['operations','support','finance','analyst']),
    (91,  'fares.manage',              'Fares',      'Create and edit draft fare rules', false, array['operations']),
    (92,  'fares.publish',             'Fares',      'Schedule or activate fare rules and set surge', true, array['finance']),
    (100, 'trips.view',                'Trips',      'View requests, trips, timelines and fare breakdowns', false, array['operations','support','finance','safety','analyst']),
    (101, 'trips.view_location',       'Trips',      'View route trails and precise points (logged)', true, array['operations','safety']),
    (102, 'trips.note',                'Trips',      'Add internal trip notes', false, array['operations','support','finance','safety']),
    (103, 'trips.cancel',              'Trips',      'Cancel an active request or trip', true, array['operations','safety']),
    (104, 'trips.resolve',             'Trips',      'Resolve trip exceptions with corrected values', true, array['operations']),
    (110, 'payments.view',             'Payments',   'View payment records', false, array['operations','support','finance']),
    (111, 'payments.reconcile',        'Payments',   'Reconcile cash and settlements, record driver deposits', true, array['finance']),
    (120, 'ledger.view',               'Ledger',     'View ledger entries and balances', false, array['finance']),
    (121, 'ledger.adjust_request',     'Ledger',     'Request a manual ledger adjustment', true, array['finance']),
    (122, 'ledger.adjust_approve',     'Ledger',     'Approve or reject ledger adjustments (maker ≠ checker)', true, array['finance']),
    (130, 'refunds.request',           'Refunds',    'Request a refund', true, array['operations','support','finance']),
    (131, 'refunds.approve',           'Refunds',    'Approve or reject refunds (maker ≠ checker)', true, array['finance']),
    (140, 'payouts.view',              'Payouts',    'View payouts', false, array['finance']),
    (141, 'payouts.create',            'Payouts',    'Create payout batches', true, array['finance']),
    (142, 'payouts.approve',           'Payouts',    'Approve payouts and mark them paid or failed (maker ≠ checker)', true, array['finance']),
    (150, 'promotions.view',           'Promotions', 'View promotions', false, array['operations','support','finance','analyst']),
    (151, 'promotions.manage',         'Promotions', 'Create, edit, activate or pause campaigns and budgets', true, array['operations']),
    (160, 'support.view',              'Support',    'View support tickets', false, array['operations','support','finance','safety']),
    (161, 'support.manage',            'Support',    'Reply to tickets, change status, resolve', false, array['operations','support','safety']),
    (162, 'support.assign',            'Support',    'Assign tickets to agents', false, array['operations']),
    (170, 'safety.view',               'Safety',     'View the incident queue (summary only)', false, array['operations','support','safety']),
    (171, 'safety.manage',             'Safety',     'Acknowledge, investigate, escalate and close incidents', true, array['safety']),
    (172, 'safety.view_evidence',      'Safety',     'Access evidence files and full incident details (logged)', true, array['safety']),
    (180, 'analytics.view',            'Analytics',  'View KPI dashboards (aggregated data)', false, array['operations','finance','analyst']),
    (181, 'analytics.export',          'Analytics',  'Export CSV data (async, logged)', true, array['finance','analyst']),
    (190, 'audit.view',                'Audit',      'View the admin audit log and change log', false, array['finance','safety']),
    (200, 'settings.view',             'Settings',   'View app settings', false, array['operations','finance']),
    (201, 'settings.manage',           'Settings',   'Change app settings and feature flags', true, array[]::text[]),
    (210, 'admins.view',               'Admins',     'View the admin list', false, array['operations']),
    (211, 'admins.invite',             'Admins',     'Invite new admins', true, array[]::text[]),
    (212, 'admins.manage_permissions', 'Admins',     'Assign templates and grant or revoke permissions', true, array[]::text[]),
    (213, 'admins.suspend',            'Admins',     'Suspend or reactivate admin accounts', true, array[]::text[])
),
inserted as (
  insert into public.permissions (code, module, description, is_high_impact, sort_order)
  select code, module, description, is_high_impact, sort_order from catalogue
  returning code
)
insert into public.permission_template_items (template_id, permission_code)
select t.id, c.code
from catalogue c
cross join lateral unnest(c.templates) as tc(code)
join public.permission_templates t on t.code = tc.code
join inserted i on i.code = c.code;
