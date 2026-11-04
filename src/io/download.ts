// Fallback save and "Download blank template" (SPEC §3.5): the browser downloads the bytes as `name`.
import { XLSX_MIME } from './fileAccess';

export function download(name: string, data: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([data], { type: XLSX_MIME }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
