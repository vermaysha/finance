import { BufferJSON, type GroupMetadata, type WASocket } from 'baileys';
import { sql } from '../db';

export const groupUpsert = async (sock: WASocket, group: GroupMetadata) => {
  const groupId = group.id;
  if (!groupId) return;

  const data = {
    id: groupId,
    data: JSON.stringify(group, BufferJSON.replacer),
  };

  await sql`INSERT INTO
    groups ${sql(data)}
  ON CONFLICT (id)
  DO UPDATE SET
    data = EXCLUDED.data,
    updated_at = unixepoch();
  `;
};
