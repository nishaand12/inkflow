-- Migration 9: Rename piercing appointment type categories to plural form
UPDATE appointment_types SET category = 'Ear Lobe Piercings'      WHERE category = 'Ear Lobe Piercing';
UPDATE appointment_types SET category = 'Ear Cartilage Piercings' WHERE category = 'Ear Cartilage Piercing';
UPDATE appointment_types SET category = 'Facial Piercings'        WHERE category = 'Facial Piercing';
UPDATE appointment_types SET category = 'Oral Piercings'          WHERE category = 'Oral Piercing';
UPDATE appointment_types SET category = 'Body Piercings'          WHERE category = 'Body Piercing';
UPDATE appointment_types SET category = 'Genital Piercings'       WHERE category = 'Genital Piercing';
UPDATE appointment_types SET category = 'Piercing Services'       WHERE category = 'Other Piercing Services';
