INSERT INTO "Effect" ("id","slug","name","description","durationSeconds","handlerKey","config","createdAt","updatedAt")
VALUES
  (gen_random_uuid(), 'freeze_players', 'Freeze Players', 'Freezes nearby players.', 3, 'freeze_nearby',
   '{"radius":120,"durationMs":3000,"includeSelf":true}'::jsonb, now(), now()),
  (gen_random_uuid(), 'scale_up', 'Scale Up', 'Temporarily scales the player up.', 30, 'scale_up',
   '{"scale":1.3}'::jsonb, now(), now()),
  (gen_random_uuid(), 'scale_down', 'Scale Down', 'Temporarily scales the player down.', 30, 'scale_down',
   '{"scale":0.7}'::jsonb, now(), now()),
  (gen_random_uuid(), 'disable_voice_all', 'Disable Voice (All)', 'Disables voice for everyone temporarily.', 20, 'disable_voice_all',
   '{}'::jsonb, now(), now()),
  (gen_random_uuid(), 'shiny', 'Shiny Effect', 'Adds a shiny glow effect.', 60, 'shiny',
   '{}'::jsonb, now(), now());

INSERT INTO "StoreItem" (
  "id", "name", "category", "price", "description",
  "imageUrl", "data", "isEquippable", "isActive", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'Frost Spell',
  'spell',
  250,
  'Freezes nearby players with an icy aura.',
  "/Flowers_Without_Outline/Lavender.png",
  NULL,
  true,
  true,
  now(),
  now()
);

INSERT INTO "StoreItemEffect" ("storeItemId","effectId","createdAt")
SELECT s.id, e.id, now()
FROM "StoreItem" s
JOIN "Effect" e ON e.slug IN ('freeze_players', 'shiny')
WHERE s.name = 'Frost Spell';
