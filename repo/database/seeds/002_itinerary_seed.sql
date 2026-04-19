-- RoadshowOps - Itinerary module seed (permissions, role mappings, sample venues)
-- Run: psql -U postgres -d roadshowops -f database/seeds/002_itinerary_seed.sql

\connect roadshowops

-- =========================================================================
-- New permissions
-- =========================================================================
INSERT INTO core.permission (code, layer, description) VALUES
  ('itinerary.read',            'action', 'Read itineraries'),
  ('itinerary.write',           'action', 'Create/update itineraries and events'),
  ('itinerary.template.manage', 'action', 'Create and edit itinerary templates'),
  ('venue.read',                'action', 'Read venues and drive times'),
  ('venue.write',               'action', 'Create/update venues and manual drive times')
ON CONFLICT (code) DO NOTHING;

-- Re-apply Administrator: all permissions
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM core.role r CROSS JOIN core.permission p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- Non-admin mappings for new perms
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('OPS_MGR',  'itinerary.read'),          ('OPS_MGR',  'itinerary.write'),
  ('OPS_MGR',  'itinerary.template.manage'),
  ('OPS_MGR',  'venue.read'),              ('OPS_MGR',  'venue.write'),

  ('RECRUITER','itinerary.read'),          ('RECRUITER','itinerary.write'),
  ('RECRUITER','venue.read'),              ('RECRUITER','venue.write'),

  ('APPROVER', 'itinerary.read'),          ('APPROVER', 'venue.read')
) AS m(role_code, perm_code)
JOIN core.role       r ON r.code = m.role_code
JOIN core.permission p ON p.code = m.perm_code
ON CONFLICT DO NOTHING;

-- =========================================================================
-- Sample venues (mix of geocoded and non-geocoded to exercise both paths)
-- =========================================================================
INSERT INTO core.venue (city_id, name, address, latitude, longitude)
SELECT c.id, v.name, v.address, v.latitude, v.longitude
FROM (VALUES
  ('NYC','NYU Career Center',     '50 W 4th St, New York, NY',      40.728920::NUMERIC, -73.997650::NUMERIC),
  ('NYC','Columbia Engineering',  '500 W 120th St, New York, NY',   40.808990::NUMERIC, -73.961400::NUMERIC),
  ('SFO','Stanford Career Hub',   '450 Jane Stanford Way, Stanford',37.430000::NUMERIC, -122.170000::NUMERIC),
  ('SFO','UCSF Mission Bay',      '1675 Owens St, San Francisco',   37.768100::NUMERIC, -122.392900::NUMERIC),
  ('CHI','UIUC Satellite',        '230 S LaSalle St, Chicago',      41.879600::NUMERIC, -87.632200::NUMERIC),
  ('AUS','Private Hackerspace',   NULL,                             NULL::NUMERIC,       NULL::NUMERIC)
) AS v(city_code, name, address, latitude, longitude)
JOIN core.city c ON c.code = v.city_code
ON CONFLICT DO NOTHING;
