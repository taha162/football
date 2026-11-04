-- =============================================================================
-- Every governorate of Iraq.
--
-- The platform started in Mosul (Nineveh) and listed only it. Each of Iraq's
-- governorates is now a city people pick when they sign up, list a venue,
-- create a match or a team, by the name most people use: the city where it's
-- the same as the governorate's, the governorate's own name otherwise (so
-- someone in Fallujah picks «الأنبار»). Mosul keeps its name and its areas.
-- Coordinates are each governorate's main city (approximate centre).
-- Areas are added by administrators as each city grows (Administration >
-- Settings > Areas); until then the area filter offers «أي منطقة».
-- All use Baghdad time and the Iraqi dinar.
--
-- Safe to run twice: existing cities are left as they are.
-- =============================================================================

insert into public.cities (slug, name_en, name_ar, country_code, timezone, currency, latitude, longitude, is_active, sort_order) values
  ('baghdad', 'Baghdad', 'بغداد', 'IQ', 'Asia/Baghdad', 'IQD', 33.315200, 44.366100, true, 1),
  ('basra', 'Basra', 'البصرة', 'IQ', 'Asia/Baghdad', 'IQD', 30.508500, 47.780400, true, 2),
  ('erbil', 'Erbil', 'أربيل', 'IQ', 'Asia/Baghdad', 'IQD', 36.191100, 44.009200, true, 4),
  ('sulaymaniyah', 'Sulaymaniyah', 'السليمانية', 'IQ', 'Asia/Baghdad', 'IQD', 35.561300, 45.437300, true, 5),
  ('kirkuk', 'Kirkuk', 'كركوك', 'IQ', 'Asia/Baghdad', 'IQD', 35.468100, 44.392200, true, 6),
  ('najaf', 'Najaf', 'النجف', 'IQ', 'Asia/Baghdad', 'IQD', 32.025900, 44.346200, true, 7),
  ('karbala', 'Karbala', 'كربلاء', 'IQ', 'Asia/Baghdad', 'IQD', 32.616000, 44.024900, true, 8),
  ('babil', 'Babil', 'بابل', 'IQ', 'Asia/Baghdad', 'IQD', 32.463700, 44.419600, true, 9),
  ('dhi-qar', 'Dhi Qar', 'ذي قار', 'IQ', 'Asia/Baghdad', 'IQD', 31.043900, 46.257600, true, 10),
  ('anbar', 'Anbar', 'الأنبار', 'IQ', 'Asia/Baghdad', 'IQD', 33.420600, 43.307800, true, 11),
  ('diyala', 'Diyala', 'ديالى', 'IQ', 'Asia/Baghdad', 'IQD', 33.746600, 44.643700, true, 12),
  ('salah-al-din', 'Saladin', 'صلاح الدين', 'IQ', 'Asia/Baghdad', 'IQD', 34.607000, 43.678200, true, 13),
  ('wasit', 'Wasit', 'واسط', 'IQ', 'Asia/Baghdad', 'IQD', 32.512800, 45.818200, true, 14),
  ('maysan', 'Maysan', 'ميسان', 'IQ', 'Asia/Baghdad', 'IQD', 31.835600, 47.144000, true, 15),
  ('qadisiyyah', 'Al-Qadisiyyah', 'القادسية', 'IQ', 'Asia/Baghdad', 'IQD', 31.992900, 44.925500, true, 16),
  ('muthanna', 'Muthanna', 'المثنى', 'IQ', 'Asia/Baghdad', 'IQD', 31.309900, 45.280300, true, 17),
  ('duhok', 'Duhok', 'دهوك', 'IQ', 'Asia/Baghdad', 'IQD', 36.866900, 42.950300, true, 18),
  ('halabja', 'Halabja', 'حلبجة', 'IQ', 'Asia/Baghdad', 'IQD', 35.177800, 45.986100, true, 19)
on conflict (slug) do nothing;

-- Mosul stays where people find it, after Baghdad and Basra.
update public.cities set sort_order = 3 where slug = 'mosul' and sort_order = 1;
