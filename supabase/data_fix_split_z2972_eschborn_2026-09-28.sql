-- One-off data fix: Eschborn Z-report 2972 (28.09.2026) covered lunch + dinner
-- because the lunch shift was never closed. Lunch receipts (11:53–15:07) total
-- €508.80 gross; the rest is dinner. VAT split, food/drinks split and Ben's
-- lunch tips are estimates. Guarded so it only runs once (on the unsplit row).
begin;

with src as (
  select * from shift_reports
  where report_date = '2026-09-28' and z_report_number = '2972' and gross_total = 4341.49
),
lunch as (
  insert into shift_reports (
    location_id, report_date, z_report_number, shift_type,
    gross_total, gross_food, gross_beverages, net_total, vat_total, tips,
    inhouse_total, takeaway_total, cancellations_count, cancellations_total,
    uploaded_by, comment)
  select location_id, report_date, '2972-L', 'lunch',
    508.80, 458.80, 50.00, 470.81, 37.99, 25.71,
    490.80, 18.00, 0, 0,
    uploaded_by, 'Split from Z 2972 (lunch shift not closed). Lunch receipts 6-3489…6-3518 + 18-683/684. VAT, food/drinks and part of tips estimated.'
  from src
  returning id
),
moved_cats as (
  update shift_report_categories c set shift_report_id = (select id from lunch)
  where c.shift_report_id = (select id from src)
    and c.category_name in ('BURRITO','QUESADILLA','BOWL','SALAT')
  returning c.id
),
moved_prods as (
  update shift_report_products p set shift_report_id = (select id from lunch)
  where p.shift_report_id = (select id from src)
    and p.product_name in (
      'Chicken Burrito','Chilli Burrito','Cochinita Burrito','Alambre Burrito',
      'Quesadilla Chicken','Quesadilla Alambre','Nachos Guacamole QUE',
      'Chicken Bowl','Barbacoa Bowl','Basic Bowl','Chicken Guacamole Bowl','Mole Chicken Bowl','Guacamole BB','Salsa Roja',
      'Salat Barbacoa','Salat Cochinita','Salat Chicken','Salat Al Pastor','Guacamole SAL',
      'Softdrinks BO','Wasser BO','Club Mate BU')
  returning p.id
)
update shift_reports s set
  shift_type = 'dinner',
  gross_total = 3832.69, gross_food = 2583.19, gross_beverages = 1249.50,
  net_total = 3464.05, vat_total = 368.64, tips = 261.68,
  inhouse_total = 3810.69, takeaway_total = 22.00,
  cancellations_count = 5, cancellations_total = 22.50,
  comment = 'Dinner part of Z 2972 — lunch (€508.80) split out into 2972-L.'
from src
where s.id = src.id and exists (select 1 from lunch);

-- Check: should show two rows, lunch 508.80 and dinner 3832.69 (sum 4341.49)
select z_report_number, shift_type, gross_total, net_total, vat_total, tips
from shift_reports where report_date = '2026-09-28' and z_report_number like '2972%';

commit;
