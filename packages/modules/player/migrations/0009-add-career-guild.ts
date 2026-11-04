const sql = `ALTER TABLE players.career_profiles
  ADD COLUMN guild_id integer CHECK (guild_id > 0),
  ADD COLUMN guild_name text,
  ADD CONSTRAINT career_profiles_guild_pair CHECK ((guild_id IS NULL) = (guild_name IS NULL)),
  ADD CONSTRAINT career_profiles_guild_name_visible CHECK (
    guild_name IS NULL OR guild_name ~ '[^[:space:]]'
  );`

export const addCareerGuild = {
  identity: 'players/0009',
  predecessor: 'players/0008',
  checksum: '47188961ff35c7af182a5fa52813aea6b1574a8aeb3e4ffbf225b9ae34673fed',
  sql,
} as const
