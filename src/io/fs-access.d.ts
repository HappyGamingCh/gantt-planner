// File System Access API members missing from TypeScript's DOM lib (WICG spec, Chromium browsers).
// Declared optional so callers feature-detect them.

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface FilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  /** Pickers with the same id remember the last folder. */
  id?: string;
}

interface Window {
  showOpenFilePicker?(options?: FilePickerOptions & { multiple?: boolean }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: FilePickerOptions & { suggestedName?: string }): Promise<FileSystemFileHandle>;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
