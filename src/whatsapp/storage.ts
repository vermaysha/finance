import {
  type AuthenticationCreds,
  initAuthCreds,
  proto,
  BufferJSON,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from 'baileys';
import { sql } from '../db';

export interface IStorage {
  state: {
    creds: AuthenticationCreds;
    keys: SignalKeyStore;
  };
  saveCreds: () => Promise<any>;
  clearCreds: () => Promise<any>;
}

export const useStorage = async (): Promise<IStorage> => {
  const read = async (key: string) => {
    try {
      const result = await sql`SELECT data FROM sessions WHERE id = ${key}`;
      const data = result[0]?.data;

      if (data) {
        const parsed = JSON.parse(data, BufferJSON.reviver) as unknown;
        return parsed as AuthenticationCreds;
      }

      return null;
    } catch (error) {
      if (error instanceof Error === false) {
        return null;
      }

      console.error('[Storage]: Read Error', error.message, key);
    }
  };

  const write = async (key: string, value: any) => {
    try {
      const data = JSON.stringify(value, BufferJSON.replacer);

      await sql`INSERT INTO sessions (id, data, updated_at)
        VALUES (${key}, ${data}, unixepoch())
        ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          updated_at = unixepoch();
      `;
    } catch (error) {
      if (error instanceof Error === false) {
        return;
      }

      console.error('[Storage]: Write Error', error.message);
    }
  };

  const remove = async (key: string) => {
    try {
      await sql`DELETE FROM sessions WHERE id = ${key}`;
    } catch (error) {
      if (error instanceof Error === false) {
        return;
      }

      console.error('[Storage]: Remove Error', error.message);
    }
  };

  const clear = async () => {
    try {
      await sql`DELETE FROM sessions`;
    } catch (error) {
      if (error instanceof Error === false) {
        return;
      }

      console.error('[Storage]: Clear Error', error.message);
    }
  };

  const creds: AuthenticationCreds = (await read('creds')) || initAuthCreds();

  const keys: SignalKeyStore = {
    get: async (type, ids) => {
      const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};
      await Promise.all(
        ids.map(async (id) => {
          let value: unknown = await read(`${type}-${id}`);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.create(value);
          }

          data[id] = value as SignalDataTypeMap[typeof type];
        }),
      );

      return data;
    },
    set: async (data: SignalDataSet) => {
      const tasks: Promise<void>[] = [];
      for (const category in data) {
        for (const id in data[category as keyof SignalDataTypeMap]) {
          const value = data[category as keyof SignalDataTypeMap]?.[id];
          const name = `${category}-${id}`;
          tasks.push(value ? write(name, value) : remove(name));
        }
      }

      await Promise.all(tasks);
    },
  };

  return {
    state: {
      creds,
      keys,
    },
    saveCreds: async () => {
      return write('creds', creds);
    },
    clearCreds: async () => {
      await clear();
    },
  };
};
