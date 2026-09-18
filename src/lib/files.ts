import { save } from '@tauri-apps/plugin-dialog';
import { saveTextFile } from './api';

/** 弹出保存对话框并写入 CSV（后端已加 BOM） */
export async function saveCsv(defaultName: string, content: string): Promise<boolean> {
  const path = await save({ defaultPath: defaultName, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (!path) return false;
  await saveTextFile(path, content);
  return true;
}
