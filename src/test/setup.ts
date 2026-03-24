import '@testing-library/jest-dom'

// Mock @tauri-apps/plugin-fs — all tests use this mock
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
}))

// Mock @tauri-apps/api/path
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/appdata'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))
