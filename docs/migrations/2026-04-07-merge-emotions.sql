-- 合并 primary_emotion + mixed_emotions → emotions
-- 执行前请先在 Supabase SQL Editor 备份数据

-- 1. 新增 emotions 列
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS emotions text[];

-- 2. 迁移旧数据：把 primary_emotion + mixed_emotions 合并进去
UPDATE journal_entries
SET emotions = ARRAY_REMOVE(
  ARRAY[primary_emotion] || COALESCE(mixed_emotions, '{}'),
  NULL
)
WHERE primary_emotion IS NOT NULL OR (mixed_emotions IS NOT NULL AND array_length(mixed_emotions, 1) > 0);

-- 3. 删除旧列
ALTER TABLE journal_entries DROP COLUMN IF EXISTS primary_emotion;
ALTER TABLE journal_entries DROP COLUMN IF EXISTS mixed_emotions;
