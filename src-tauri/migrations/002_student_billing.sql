-- 免费学员：paid | free。free 的学生点名照常记出勤，但不扣课时、不算欠费
ALTER TABLE student ADD COLUMN billing TEXT NOT NULL DEFAULT 'paid';
