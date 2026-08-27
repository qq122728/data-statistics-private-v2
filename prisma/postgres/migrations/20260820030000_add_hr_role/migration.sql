-- 行政仅能查看人员档案与考勤；权限限制在应用层，数据库只新增岗位枚举值。
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HR';
